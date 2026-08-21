import { z } from "zod"

const resetCountsSchema = z
  .object({
    legacyTrees: z.number().int().nonnegative(),
    legacyGenerations: z.number().int().nonnegative(),
    legacyFeedback: z.number().int().nonnegative(),
    mappings: z.number().int().nonnegative(),
    canonicalConversations: z.number().int().nonnegative(),
    canonicalGenerations: z.number().int().nonnegative(),
    canonicalFeedback: z.number().int().nonnegative(),
    canonicalArtifacts: z.number().int().nonnegative(),
    commandRecords: z.number().int().nonnegative(),
    outboxEvents: z.number().int().nonnegative(),
    preservedUsageRecords: z.number().int().nonnegative(),
  })
  .strict()

export const approvedConversationResetSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal("approved-conversation-reset"),
    environment: z.string().trim().min(1),
    database: z
      .object({
        host: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strict(),
    scope: z
      .object({
        legacyTreeIds: z.union([
          z.literal("all"),
          z.array(z.string().trim().min(1)).min(1),
        ]),
      })
      .strict(),
    expected: resetCountsSchema,
    backupId: z.string().trim().min(1),
    approvalId: z.string().trim().min(1),
    approvedBy: z.string().trim().min(1),
    approvedAt: z.string().datetime(),
    reason: z.string().trim().min(1),
  })
  .strict()

export const conversationBackupVerificationSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal("conversation-backup-verification"),
    environment: z.string().trim().min(1),
    database: z
      .object({
        host: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strict(),
    backupId: z.string().trim().min(1),
    backupSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    restoreTestId: z.string().trim().min(1),
    verifiedAt: z.string().datetime(),
    verifiedBy: z.string().trim().min(1),
  })
  .strict()

export type ApprovedConversationReset = z.infer<
  typeof approvedConversationResetSchema
>
export type ConversationBackupVerification = z.infer<
  typeof conversationBackupVerificationSchema
>
export type ApprovedConversationResetCounts = z.infer<typeof resetCountsSchema>

export function assertApprovedConversationResetContext(input: {
  readonly approval: ApprovedConversationReset
  readonly backup: ConversationBackupVerification
  readonly environment: string | undefined
  readonly databaseHost: string
  readonly databaseName: string
  readonly approvalId: string | undefined
  readonly backupId: string | undefined
  readonly resetEnabled: string | undefined
  readonly actualCounts: ApprovedConversationResetCounts
}): void {
  const { approval, backup } = input
  if (input.resetEnabled !== "true")
    throw new Error("CONVERSATION_APPROVED_RESET_ENABLED 必须显式为 true")
  if (!input.environment || input.environment !== approval.environment)
    throw new Error("当前环境与重置审批不匹配")
  if (input.approvalId !== approval.approvalId)
    throw new Error("CONVERSATION_CUTOVER_APPROVAL_ID 与重置审批不匹配")
  if (input.backupId !== approval.backupId)
    throw new Error("CONVERSATION_CUTOVER_BACKUP_ID 与重置审批不匹配")
  if (
    input.databaseHost !== approval.database.host ||
    input.databaseName !== approval.database.name
  )
    throw new Error("当前数据库与重置审批目标不匹配")
  if (
    backup.environment !== approval.environment ||
    backup.database.host !== approval.database.host ||
    backup.database.name !== approval.database.name ||
    backup.backupId !== approval.backupId
  )
    throw new Error("备份恢复验证与重置审批不匹配")
  if (JSON.stringify(input.actualCounts) !== JSON.stringify(approval.expected))
    throw new Error(
      `重置前计数与审批不一致：expected=${JSON.stringify(approval.expected)} actual=${JSON.stringify(input.actualCounts)}`
    )
}
