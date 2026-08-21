import { createHash } from "node:crypto"

import { z } from "zod"

const rate = z.number().min(0).max(1)
const nonnegative = z.number().int().nonnegative()

const backupSchema = z
  .object({
    id: z.string().trim().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    restoreTestId: z.string().trim().min(1),
    verifiedAt: z.string().datetime(),
    verifiedBy: z.string().trim().min(1),
  })
  .strict()

export const conversationCutoverManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal("conversation-cutover-release"),
    environment: z.string().trim().min(1),
    database: z
      .object({
        host: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strict(),
    authority: z
      .object({
        from: z.literal("legacy"),
        to: z.literal("canonical"),
        epoch: z.string().trim().min(1),
      })
      .strict(),
    owners: z
      .object({
        release: z.string().trim().min(1),
        data: z.string().trim().min(1),
        billing: z.string().trim().min(1),
        incident: z.string().trim().min(1),
      })
      .strict(),
    windows: z
      .object({
        maintenanceStartsAt: z.string().datetime(),
        maintenanceEndsAt: z.string().datetime(),
        observationEndsAt: z.string().datetime(),
      })
      .strict(),
    baseline: z
      .object({
        capturedAt: z.string().datetime(),
        legacyTrees: nonnegative,
        legacyGenerations: nonnegative,
        canonicalConversations: nonnegative,
        requestsPerMinute: z.number().nonnegative(),
        commandErrorRate: rate,
        revisionConflictRate: rate,
        usageUnavailableRate: rate,
      })
      .strict(),
    thresholds: z
      .object({
        maxMaintenanceSeconds: z.number().int().positive(),
        maxImportSeconds: z.number().int().positive(),
        maxCommandErrorRate: rate,
        maxRevisionConflictRate: rate,
        maxGenerationHeartbeatAgeSeconds: z.number().int().positive(),
        maxPendingBilling: nonnegative,
        maxPendingOutbox: nonnegative,
        maxUsageUnavailableRate: rate,
        maxLegacyRouteCalls: nonnegative,
        maxLegacySqlCalls: nonnegative,
      })
      .strict(),
    disposition: z
      .object({
        mode: z.enum(["deterministic-import", "approved-reset"]),
        retentionRequired: z.boolean(),
        legacyTreeIds: z.union([
          z.literal("all"),
          z.array(z.string().trim().min(1)).min(1),
        ]),
        adrId: z.string().trim().min(1),
        approvalId: z.string().trim().min(1),
        approvedBy: z.string().trim().min(1),
        approvedAt: z.string().datetime(),
        reason: z.string().trim().min(1),
        exclusions: z.array(z.string().trim().min(1)),
      })
      .strict(),
    backups: z
      .object({
        legacy: backupSchema,
        canonical: backupSchema,
      })
      .strict(),
    goNoGo: z
      .object({
        strictSpecsPassed: z.boolean(),
        behaviorMatrixPassed: z.boolean(),
        securityReviewPassed: z.boolean(),
        dataAuditResolved: z.boolean(),
        drainReady: z.boolean(),
        backupRestorePassed: z.boolean(),
        rollbackRehearsalPassed: z.boolean(),
        canaryActorsReady: z.boolean(),
        dashboardsReady: z.boolean(),
        finalApprovalGranted: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const maintenanceStart = Date.parse(manifest.windows.maintenanceStartsAt)
    const maintenanceEnd = Date.parse(manifest.windows.maintenanceEndsAt)
    const observationEnd = Date.parse(manifest.windows.observationEndsAt)
    if (maintenanceStart >= maintenanceEnd)
      context.addIssue({
        code: "custom",
        path: ["windows", "maintenanceEndsAt"],
        message: "维护结束时间必须晚于开始时间",
      })
    if (maintenanceEnd >= observationEnd)
      context.addIssue({
        code: "custom",
        path: ["windows", "observationEndsAt"],
        message: "观察窗口必须晚于维护窗口结束",
      })
    if (
      manifest.disposition.retentionRequired &&
      manifest.disposition.mode !== "deterministic-import"
    )
      context.addIssue({
        code: "custom",
        path: ["disposition", "mode"],
        message: "存在数据保留义务时必须选择确定性导入",
      })
    if (
      new Set(
        Object.values(manifest.owners).map((owner) => owner.toLowerCase())
      ).size < 2
    )
      context.addIssue({
        code: "custom",
        path: ["owners"],
        message: "至少需要两个独立责任主体，不能由单人包揽全部门禁",
      })
  })

export type ConversationCutoverManifest = z.infer<
  typeof conversationCutoverManifestSchema
>

export function canonicalManifestJson(
  manifest: ConversationCutoverManifest
): string {
  return JSON.stringify(manifest)
}

export function hashConversationCutoverManifest(
  manifest: ConversationCutoverManifest
): string {
  return createHash("sha256")
    .update(canonicalManifestJson(manifest))
    .digest("hex")
}

export function assertConversationCutoverManifestReady(input: {
  readonly manifest: ConversationCutoverManifest
  readonly environment: string
  readonly databaseHost: string
  readonly databaseName: string
  readonly now?: Date
}): void {
  const { manifest } = input
  if (input.environment !== manifest.environment)
    throw new Error("当前环境与 cutover manifest 不匹配")
  if (
    input.databaseHost !== manifest.database.host ||
    input.databaseName !== manifest.database.name
  )
    throw new Error("当前数据库与 cutover manifest 不匹配")
  const failed = Object.entries(manifest.goNoGo)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  if (failed.length > 0)
    throw new Error(`go/no-go 门禁未通过：${failed.join(", ")}`)
  const now = input.now ?? new Date()
  if (now.getTime() >= Date.parse(manifest.windows.maintenanceEndsAt))
    throw new Error("cutover manifest 的维护窗口已经结束")
  if (
    Date.parse(manifest.backups.legacy.verifiedAt) >=
      Date.parse(manifest.windows.maintenanceStartsAt) ||
    Date.parse(manifest.backups.canonical.verifiedAt) >=
      Date.parse(manifest.windows.maintenanceStartsAt)
  )
    throw new Error("备份恢复验证必须在维护窗口开始前完成")
}

export function assertConversationCutoverManifestDisposition(input: {
  readonly manifest: ConversationCutoverManifest
  readonly mode: "deterministic-import" | "approved-reset"
  readonly approvalId: string
  readonly backupId: string
  readonly legacyTreeIds: "all" | readonly string[]
}): void {
  const { disposition } = input.manifest
  if (disposition.mode !== input.mode)
    throw new Error(`cutover manifest 未批准 ${input.mode}`)
  if (disposition.approvalId !== input.approvalId)
    throw new Error("cutover manifest approval ID 与执行审批不匹配")
  const expectedBackup =
    input.mode === "deterministic-import"
      ? input.manifest.backups.legacy.id
      : input.manifest.backups.canonical.id
  if (expectedBackup !== input.backupId)
    throw new Error("cutover manifest backup ID 与执行审批不匹配")
  const manifestScope = disposition.legacyTreeIds
  if (
    JSON.stringify(
      manifestScope === "all" ? "all" : [...manifestScope].sort()
    ) !==
    JSON.stringify(
      input.legacyTreeIds === "all" ? "all" : [...input.legacyTreeIds].sort()
    )
  )
    throw new Error("cutover manifest scope 与执行审批不匹配")
}
