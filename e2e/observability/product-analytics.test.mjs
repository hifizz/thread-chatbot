// 产品分析与隐私门控的合同测试（任务 4.3）：
// 稳定事件 ID、同意门控、客户端/服务端事件命名空间、trace 映射回读、
// 成本覆盖语义与 UTC 指标边界。纯单元测试，不依赖数据库与真实投递。
import assert from "node:assert/strict"

process.env.AI_OBSERVABILITY_ID_SALT ??= "analytics-test-salt"

const { buildProductEvent, parseProductEvent, stableProductEventId } =
  await import("../../lib/analytics/events.ts")
const { emitProductEvent } = await import("../../lib/analytics/dispatch.ts")
const {
  isSafeAnalyticsEvent,
  isClientAnalyticsEvent,
} = await import("../../lib/privacy/analytics-gate.ts")
const {
  resolveMessageTraceId,
  generationTraceId,
  assistantMessageTraceId,
} = await import("../../lib/observability/identity.ts")
const { resolveCostCoverage, resolveMetricsRange, cohortWindowComplete } =
  await import("../../lib/admin/metrics.ts")
const { isUtcDay, shiftUtcDay, utcToday } = await import(
  "../../lib/analytics/utc-day.ts"
)

const GENERATION_ID = "11111111-2222-4333-8444-555555555555"

// ---- 1. 稳定 eventId：同事实同 ID，重试不重复计数 ----
const idA = stableProductEventId({
  name: "generation.started",
  factId: GENERATION_ID,
  factVersion: 1,
})
assert.equal(
  idA,
  stableProductEventId({
    name: "generation.started",
    factId: GENERATION_ID,
    factVersion: 1,
  }),
  "相同事实+版本必须得到相同 eventId"
)
assert.notEqual(
  idA,
  stableProductEventId({
    name: "generation.started",
    factId: GENERATION_ID,
    factVersion: 2,
  }),
  "事实版本变化必须产生新 eventId"
)
assert.notEqual(
  idA,
  stableProductEventId({
    name: "generation.completed",
    factId: GENERATION_ID,
    factVersion: 1,
  }),
  "不同事件名不得共享 eventId"
)
assert.match(idA, /^[0-9a-f]{64}$/)

// ---- 2. 事件构建与校验 ----
const started = buildProductEvent({
  name: "generation.started",
  factId: GENERATION_ID,
  userId: "user-1",
  release: "abc123",
  environment: "staging",
  payload: { generationId: GENERATION_ID, modelId: "gpt-5.6-luna" },
})
assert.equal(started.id, idA)
assert.equal(started.schemaVersion, 1)
assert.ok(parseProductEvent(started), "合法事件必须通过白名单校验")

assert.equal(
  parseProductEvent({
    ...started,
    payload: { generationId: GENERATION_ID, modelId: "x", prompt: "hi" },
  }),
  null,
  "payload 含禁止属性名（prompt）必须拒绝"
)
assert.equal(
  parseProductEvent({
    ...started,
    payload: { generationId: "not-a-uuid", modelId: "x" },
  }),
  null,
  "payload 形状不符必须拒绝"
)
assert.equal(
  parseProductEvent({ ...started, name: "user.deleted" }),
  null,
  "未登记事件名必须拒绝"
)

// ---- 3. 隐私门控：hygiene 与客户端命名空间分层 ----
assert.ok(
  isSafeAnalyticsEvent({ name: "generation.completed" }),
  "服务端事实事件必须通过 hygiene 检查"
)
assert.equal(
  isClientAnalyticsEvent({ name: "generation.completed" }),
  false,
  "客户端不得伪造服务端事实事件"
)
assert.equal(
  isClientAnalyticsEvent({ name: "credit.exhausted" }),
  false,
  "客户端不得伪造账务事件"
)
assert.ok(
  isClientAnalyticsEvent({ name: "app.opened", properties: { surface: "x" } }),
  "普通客户端事件在 hygiene 内仍可通过"
)
assert.equal(
  isSafeAnalyticsEvent({ properties: { token_count: 3 }, name: "x" }),
  false,
  "属性名命中禁用词（token）必须拒绝"
)

// ---- 4. 同意门控：emitProductEvent 三种 skip/失败不抛错 ----
const baseEmit = {
  name: "generation.started",
  factId: GENERATION_ID,
  userId: "user-1",
  payload: { generationId: GENERATION_ID, modelId: "m" },
}

const noConsent = await emitProductEvent(baseEmit, {
  hasConsent: async () => false,
  deliver: async () => {
    throw new Error("must not be called")
  },
})
assert.deepEqual(noConsent.status, "skipped")
assert.equal(noConsent.reason, "no-consent")
assert.equal(noConsent.eventId, idA, "无同意也要返回稳定 eventId")

const delivered = await emitProductEvent(baseEmit, {
  hasConsent: async () => true,
  deliver: async () => ({ status: "delivered" }),
})
assert.equal(delivered.status, "delivered")

const notConfigured = await emitProductEvent(baseEmit, {
  hasConsent: async () => true,
  deliver: async () => ({ status: "skipped" }),
})
assert.equal(notConfigured.status, "skipped")
assert.equal(notConfigured.reason, "not-configured")

const failed = await emitProductEvent(baseEmit, {
  hasConsent: async () => true,
  deliver: async () => ({ status: "failed", errorCategory: "timeout" }),
})
assert.equal(failed.status, "failed")
assert.equal(failed.errorCategory, "timeout")
assert.equal(failed.eventId, idA)

// 投递抛异常也不得向业务链路抛出
const threw = await emitProductEvent(baseEmit, {
  hasConsent: async () => true,
  deliver: async () => {
    throw new Error("network down")
  },
})
assert.equal(threw.status, "failed")

// 跨账号：同一事件名/事实，不同用户只改变 consent/identity，eventId 不变
const otherUser = await emitProductEvent(
  { ...baseEmit, userId: "user-2" },
  { hasConsent: async () => false }
)
assert.equal(
  otherUser.eventId,
  idA,
  "eventId 由事实决定，与用户身份无关（跨账号不串）"
)

// ---- 5. trace 映射：v2 落库优先，历史行回落 v1 ----
const storedV2 = await generationTraceId(GENERATION_ID)
const resolvedV2 = await resolveMessageTraceId({
  id: GENERATION_ID,
  traceId: storedV2,
  traceMappingVersion: 2,
})
assert.equal(resolvedV2.traceId, storedV2)
assert.equal(resolvedV2.traceMappingVersion, 2)

const legacy = await resolveMessageTraceId({ id: GENERATION_ID })
assert.equal(legacy.traceMappingVersion, 1)
assert.equal(
  legacy.traceId,
  await assistantMessageTraceId(GENERATION_ID),
  "历史行必须回落 v1 message-scope ID"
)
assert.notEqual(
  legacy.traceId,
  storedV2,
  "v1/v2 命名空间必须隔离，不互相碰撞"
)

// 列存在但 version 不是 v2 → 仍回落 v1（数据不一致时保守读旧映射）
const inconsistent = await resolveMessageTraceId({
  id: GENERATION_ID,
  traceId: storedV2,
  traceMappingVersion: 1,
})
assert.equal(inconsistent.traceMappingVersion, 1)

// ---- 6. 成本覆盖与 UTC 边界 ----
assert.equal(resolveCostCoverage(0, 0), "none")
assert.equal(resolveCostCoverage(5, 0), "complete")
assert.equal(resolveCostCoverage(0, 3), "estimated")
assert.equal(resolveCostCoverage(2, 1), "partial")

assert.ok(isUtcDay("2025-01-15"))
assert.equal(isUtcDay("2025-13-01"), false)
assert.equal(isUtcDay("15/01/2025"), false)
assert.equal(shiftUtcDay("2025-01-31", 1), "2025-02-01")
assert.equal(utcToday(new Date("2025-06-30T23:59:59Z")), "2025-06-30")

const defaultRange = resolveMetricsRange({ now: new Date("2025-07-14T12:00:00Z") })
assert.deepEqual(defaultRange, { from: "2025-07-01", to: "2025-07-14" })
assert.equal(
  resolveMetricsRange({ from: "2025-07-10", to: "2025-07-01" }),
  null,
  "from>to 必须拒绝"
)
assert.equal(
  resolveMetricsRange({ from: "2025-01-01", to: "2025-04-30" }),
  null,
  "超过最大范围必须拒绝"
)

// ---- 7. 未成熟观察窗口：D1/D7 目标日未过一律不成熟，不判流失 ----
assert.equal(
  cohortWindowComplete("2025-07-10", 7, "2025-07-18"),
  true,
  "D7 目标日已过的 cohort 窗口成熟"
)
assert.equal(
  cohortWindowComplete("2025-07-10", 7, "2025-07-17"),
  false,
  "D7 目标日即当天仍属未成熟"
)
assert.equal(
  cohortWindowComplete("2025-07-10", 7, "2025-07-12"),
  false,
  "D7 目标日之前更不成熟"
)
assert.equal(
  cohortWindowComplete("2025-07-10", 1, "2025-07-11"),
  false,
  "D1 目标日即当天不算完整观察"
)
assert.equal(cohortWindowComplete("2025-07-10", 1, "2025-07-12"), true)

console.log("product-analytics contract tests passed")
