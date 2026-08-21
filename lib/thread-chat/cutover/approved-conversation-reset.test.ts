import assert from "node:assert/strict"
import test from "node:test"

import {
  approvedConversationResetSchema,
  assertApprovedConversationResetContext,
  conversationBackupVerificationSchema,
} from "./approved-conversation-reset.ts"

const database = { host: "127.0.0.1", name: "thread-chat" }
const expected = {
  legacyTrees: 1,
  legacyGenerations: 2,
  legacyFeedback: 1,
  mappings: 9,
  canonicalConversations: 1,
  canonicalGenerations: 2,
  canonicalFeedback: 1,
  canonicalArtifacts: 0,
  commandRecords: 0,
  outboxEvents: 0,
  preservedUsageRecords: 2,
}
const approval = approvedConversationResetSchema.parse({
  schemaVersion: 1,
  action: "approved-conversation-reset",
  environment: "isolated-rehearsal",
  database,
  scope: { legacyTreeIds: ["tree-1"] },
  expected,
  backupId: "backup-1",
  approvalId: "adr-34-reset-1",
  approvedBy: "owner@example.com",
  approvedAt: "2026-08-22T00:00:00.000Z",
  reason: "无保留义务的隔离演练数据",
})
const backup = conversationBackupVerificationSchema.parse({
  schemaVersion: 1,
  action: "conversation-backup-verification",
  environment: "isolated-rehearsal",
  database,
  backupId: "backup-1",
  backupSha256: "a".repeat(64),
  restoreTestId: "restore-1",
  verifiedAt: "2026-08-22T00:10:00.000Z",
  verifiedBy: "owner@example.com",
})

function validContext() {
  return {
    approval,
    backup,
    environment: "isolated-rehearsal",
    databaseHost: database.host,
    databaseName: database.name,
    approvalId: approval.approvalId,
    backupId: approval.backupId,
    resetEnabled: "true",
    actualCounts: expected,
  }
}

test("精确匹配环境、审批、备份恢复证明与计数时允许重置", () => {
  assert.doesNotThrow(() =>
    assertApprovedConversationResetContext(validContext())
  )
})

test("缺少独立 reset 开关时 fail closed", () => {
  assert.throws(
    () =>
      assertApprovedConversationResetContext({
        ...validContext(),
        resetEnabled: undefined,
      }),
    /APPROVED_RESET_ENABLED/u
  )
})

test("环境、备份标识或预计计数漂移时拒绝执行", () => {
  assert.throws(
    () =>
      assertApprovedConversationResetContext({
        ...validContext(),
        environment: "production",
      }),
    /环境/u
  )
  assert.throws(
    () =>
      assertApprovedConversationResetContext({
        ...validContext(),
        backupId: "other-backup",
      }),
    /BACKUP_ID/u
  )
  assert.throws(
    () =>
      assertApprovedConversationResetContext({
        ...validContext(),
        actualCounts: { ...expected, legacyTrees: 2 },
      }),
    /计数/u
  )
})
