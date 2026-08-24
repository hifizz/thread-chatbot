import assert from "node:assert/strict"
import test from "node:test"

import {
  conversationRecoveryRequestSchema,
  planConversationRecovery,
} from "./conversation-forward-recovery.ts"

const base = {
  schemaVersion: 1 as const,
  action: "conversation-recovery-plan" as const,
  environment: "production",
  database: { host: "db.internal", name: "thread-chat" },
  cutoverEpoch: "epoch-34",
  currentAuthority: "canonical" as const,
  firstCanonicalWriteAt: "2026-08-22T01:00:00.000Z",
  requestedAction: "deploy-forward-fix" as const,
  targetAuthority: "canonical" as const,
  dataFlow: "none" as const,
  backup: null,
  incidentId: "incident-34",
  approvedBy: "owner@example.com",
  approvedAt: "2026-08-22T01:05:00.000Z",
}

test("首个 canonical 写入后只生成 canonical 前滚恢复计划", () => {
  const plan = planConversationRecovery(
    conversationRecoveryRequestSchema.parse(base)
  )
  assert.equal(plan.mode, "post-write-forward-recovery")
  assert.equal(plan.targetAuthority, "canonical")
  assert.equal(plan.maintenanceMode, "read-only")
  assert.match(plan.forbidden.join(" "), /canonical → legacy/u)
})

test("首个 canonical 写入后拒绝 legacy authority、反向同步和 legacy 备份", () => {
  const cases = [
    { request: { ...base, targetAuthority: "legacy" }, error: /legacy/u },
    {
      request: { ...base, dataFlow: "canonical-to-legacy" },
      error: /反向/u,
    },
    {
      request: {
        ...base,
        requestedAction: "restore-canonical-backup",
        backup: {
          kind: "legacy",
          id: "legacy-1",
          restoreTestId: "restore-1",
        },
      },
      error: /canonical 备份/u,
    },
  ]
  for (const entry of cases)
    assert.throws(
      () =>
        planConversationRecovery(
          conversationRecoveryRequestSchema.parse(entry.request)
        ),
      entry.error
    )
})

test("首个 canonical 写入前只允许无数据复制的 legacy abort", () => {
  const request = conversationRecoveryRequestSchema.parse({
    ...base,
    currentAuthority: "canonical",
    firstCanonicalWriteAt: null,
    requestedAction: "abort-before-canonical-write",
    targetAuthority: "legacy",
    dataFlow: "none",
    backup: { kind: "legacy", id: "legacy-1", restoreTestId: "restore-1" },
  })
  const plan = planConversationRecovery(request)
  assert.equal(plan.mode, "pre-write-abort")
  assert.equal(plan.dataFlow, "none")
})

test("恢复 canonical 备份要求恢复演练标识并保持 canonical-to-canonical", () => {
  const request = conversationRecoveryRequestSchema.parse({
    ...base,
    requestedAction: "restore-canonical-backup",
    dataFlow: "canonical-to-canonical",
    backup: {
      kind: "canonical",
      id: "canonical-1",
      restoreTestId: "restore-canonical-1",
    },
  })
  assert.equal(
    planConversationRecovery(request).dataFlow,
    "canonical-to-canonical"
  )
})
