/**
 * Web Search 外部计费纯函数测试：
 *   node --experimental-strip-types e2e/thread-chat/web-search-metering.test.mjs
 */
import {
  externalCostMicros,
  tavilyBasicSearchCostMicros,
  tavilyBasicSearchPriceMicros,
} from "../../constants/pricing.ts"
import {
  createExternalUsageAccumulator,
  externalUsageIdempotencyKey,
  fingerprintExternalQuery,
} from "../../lib/billing/external-usage.ts"
import { buildUsageMetadata } from "../../lib/billing/usage-meta.ts"

let failed = 0
const ok = (label, condition) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`)
  if (!condition) failed = 1
}

ok("Tavily Basic 单次 PAYG 成本为 ¥0.0584", tavilyBasicSearchCostMicros() === 58_400)
ok(
  "30% margin 并向上取整后单次售价为 ¥0.083429",
  tavilyBasicSearchPriceMicros() === 83_429
)
ok("失败且未消耗 credit 时成本为 0", externalCostMicros(0, 0.008) === 0)

const fingerprint = fingerprintExternalQuery("  Ａuto Search  ")
ok("query 指纹为 SHA-256 hex", /^[a-f0-9]{64}$/.test(fingerprint))
ok(
  "query 指纹先 trim + NFKC",
  fingerprint === fingerprintExternalQuery("Auto Search")
)

const firstKey = externalUsageIdempotencyKey("tavily", "request-1", 0)
ok(
  "相同 provider/request/callIndex 产生稳定幂等键",
  firstKey === externalUsageIdempotencyKey("tavily", "request-1", 0)
)
ok(
  "不同 callIndex 不共享幂等键",
  firstKey !== externalUsageIdempotencyKey("tavily", "request-1", 1)
)

const accumulator = createExternalUsageAccumulator()
accumulator.record({
  callIndex: 0,
  billableUnits: 1,
  costMicros: 58_400,
  priceMicros: 83_429,
})
accumulator.record({
  callIndex: 0,
  billableUnits: 1,
  costMicros: 58_400,
  priceMicros: 83_429,
})
accumulator.record({
  callIndex: 1,
  billableUnits: 0,
  costMicros: 0,
  priceMicros: 0,
})
const totals = accumulator.snapshot()
ok("metadata 累加器按 callIndex 去重", totals.callCount === 2)
ok("失败调用计入 call count 但不计 billable unit", totals.billableUnits === 1)
ok("metadata 搜索费用仅累计一次", totals.priceMicros === 83_429)

const metadata = buildUsageMetadata(
  "glm-5.2",
  { inputTokens: 1_000, outputTokens: 500 },
  totals
)
ok(
  "assistant metadata 顶层售价等于模型与搜索之和",
  metadata.priceMicros === metadata.modelPriceMicros + totals.priceMicros
)
ok(
  "assistant metadata 保留独立外部用量 breakdown",
  metadata.externalUsage.callCount === 2 &&
    metadata.externalUsage.billableUnits === 1
)

process.exit(failed)
