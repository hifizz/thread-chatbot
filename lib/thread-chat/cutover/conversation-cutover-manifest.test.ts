import assert from "node:assert/strict"
import test from "node:test"

import {
  assertConversationCutoverManifestDisposition,
  assertConversationCutoverManifestReady,
  conversationCutoverManifestSchema,
  hashConversationCutoverManifest,
} from "./conversation-cutover-manifest.ts"

const manifestInput = {
  schemaVersion: 1 as const,
  action: "conversation-cutover-release" as const,
  environment: "staging",
  database: { host: "db.internal", name: "thread-chat" },
  authority: {
    from: "legacy" as const,
    to: "canonical" as const,
    epoch: "epoch-34",
  },
  owners: {
    release: "release@example.com",
    data: "data@example.com",
    billing: "billing@example.com",
    incident: "release@example.com",
  },
  windows: {
    maintenanceStartsAt: "2026-08-23T01:00:00.000Z",
    maintenanceEndsAt: "2026-08-23T02:00:00.000Z",
    observationEndsAt: "2026-08-30T02:00:00.000Z",
  },
  baseline: {
    capturedAt: "2026-08-22T00:00:00.000Z",
    legacyTrees: 19,
    legacyGenerations: 37,
    canonicalConversations: 0,
    requestsPerMinute: 1,
    commandErrorRate: 0,
    revisionConflictRate: 0,
    usageUnavailableRate: 0,
  },
  thresholds: {
    maxMaintenanceSeconds: 3600,
    maxImportSeconds: 600,
    maxCommandErrorRate: 0.01,
    maxRevisionConflictRate: 0.01,
    maxGenerationHeartbeatAgeSeconds: 120,
    maxPendingBilling: 0,
    maxPendingOutbox: 0,
    maxUsageUnavailableRate: 0.01,
    maxLegacyRouteCalls: 0,
    maxLegacySqlCalls: 0,
  },
  disposition: {
    mode: "deterministic-import" as const,
    retentionRequired: true,
    legacyTreeIds: "all" as const,
    adrId: "ADR-34",
    approvalId: "approval-34",
    approvedBy: "data@example.com",
    approvedAt: "2026-08-22T01:00:00.000Z",
    reason: "保留全部用户数据",
    exclusions: [],
  },
  backups: {
    legacy: {
      id: "legacy-backup",
      sha256: "a".repeat(64),
      restoreTestId: "legacy-restore",
      verifiedAt: "2026-08-22T02:00:00.000Z",
      verifiedBy: "data@example.com",
    },
    canonical: {
      id: "canonical-backup",
      sha256: "b".repeat(64),
      restoreTestId: "canonical-restore",
      verifiedAt: "2026-08-22T02:00:00.000Z",
      verifiedBy: "data@example.com",
    },
  },
  goNoGo: {
    strictSpecsPassed: true,
    behaviorMatrixPassed: true,
    securityReviewPassed: true,
    dataAuditResolved: true,
    drainReady: true,
    backupRestorePassed: true,
    rollbackRehearsalPassed: true,
    canaryActorsReady: true,
    dashboardsReady: true,
    finalApprovalGranted: true,
  },
}

test("完整 manifest 在环境、数据库、窗口与所有门禁匹配时可执行", () => {
  const manifest = conversationCutoverManifestSchema.parse(manifestInput)
  assert.doesNotThrow(() =>
    assertConversationCutoverManifestReady({
      manifest,
      environment: "staging",
      databaseHost: "db.internal",
      databaseName: "thread-chat",
      now: new Date("2026-08-23T00:30:00.000Z"),
    })
  )
  assert.equal(hashConversationCutoverManifest(manifest).length, 64)
})

test("保留数据时拒绝 reset，且窗口顺序必须有效", () => {
  assert.throws(
    () =>
      conversationCutoverManifestSchema.parse({
        ...manifestInput,
        disposition: { ...manifestInput.disposition, mode: "approved-reset" },
      }),
    /确定性导入/u
  )
  assert.throws(
    () =>
      conversationCutoverManifestSchema.parse({
        ...manifestInput,
        windows: {
          ...manifestInput.windows,
          maintenanceEndsAt: "2026-08-23T00:00:00.000Z",
        },
      }),
    /维护结束时间/u
  )
})

test("执行校验拒绝环境漂移、未通过门禁和过期窗口", () => {
  const manifest = conversationCutoverManifestSchema.parse(manifestInput)
  assert.throws(
    () =>
      assertConversationCutoverManifestReady({
        manifest,
        environment: "production",
        databaseHost: "db.internal",
        databaseName: "thread-chat",
      }),
    /环境/u
  )
  const notReady = conversationCutoverManifestSchema.parse({
    ...manifestInput,
    goNoGo: { ...manifestInput.goNoGo, dashboardsReady: false },
  })
  assert.throws(
    () =>
      assertConversationCutoverManifestReady({
        manifest: notReady,
        environment: "staging",
        databaseHost: "db.internal",
        databaseName: "thread-chat",
        now: new Date("2026-08-23T00:30:00.000Z"),
      }),
    /dashboardsReady/u
  )
  assert.throws(
    () =>
      assertConversationCutoverManifestReady({
        manifest,
        environment: "staging",
        databaseHost: "db.internal",
        databaseName: "thread-chat",
        now: new Date("2026-08-23T03:00:00.000Z"),
      }),
    /维护窗口已经结束/u
  )
})

test("执行动作必须与 manifest 的 ADR 模式、审批、备份和 scope 一致", () => {
  const manifest = conversationCutoverManifestSchema.parse(manifestInput)
  assert.doesNotThrow(() =>
    assertConversationCutoverManifestDisposition({
      manifest,
      mode: "deterministic-import",
      approvalId: "approval-34",
      backupId: "legacy-backup",
      legacyTreeIds: "all",
    })
  )
  for (const override of [
    { mode: "approved-reset" as const },
    { approvalId: "other" },
    { backupId: "other" },
    { legacyTreeIds: ["tree-1"] },
  ])
    assert.throws(() =>
      assertConversationCutoverManifestDisposition({
        manifest,
        mode: "deterministic-import",
        approvalId: "approval-34",
        backupId: "legacy-backup",
        legacyTreeIds: "all",
        ...override,
      })
    )
})
