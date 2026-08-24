import { z } from "zod"

export const conversationRecoveryRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal("conversation-recovery-plan"),
    environment: z.string().trim().min(1),
    database: z
      .object({
        host: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strict(),
    cutoverEpoch: z.string().trim().min(1),
    currentAuthority: z.enum(["legacy", "canonical"]),
    firstCanonicalWriteAt: z.string().datetime().nullable(),
    requestedAction: z.enum([
      "abort-before-canonical-write",
      "restore-canonical-backup",
      "deploy-forward-fix",
    ]),
    targetAuthority: z.enum(["legacy", "canonical"]),
    dataFlow: z.enum(["none", "canonical-to-canonical", "canonical-to-legacy"]),
    backup: z
      .object({
        kind: z.enum(["legacy", "canonical"]),
        id: z.string().trim().min(1),
        restoreTestId: z.string().trim().min(1),
      })
      .strict()
      .nullable(),
    incidentId: z.string().trim().min(1),
    approvedBy: z.string().trim().min(1),
    approvedAt: z.string().datetime(),
  })
  .strict()

export type ConversationRecoveryRequest = z.infer<
  typeof conversationRecoveryRequestSchema
>

export interface ConversationRecoveryPlan {
  readonly mode: "pre-write-abort" | "post-write-forward-recovery"
  readonly targetAuthority: "legacy" | "canonical"
  readonly maintenanceMode: "read-only"
  readonly dataFlow: "none" | "canonical-to-canonical"
  readonly steps: readonly string[]
  readonly forbidden: readonly string[]
}

/**
 * Cutover rollback 不是双写或反向迁移。首个 canonical 写入之后，恢复只能留在
 * canonical authority 内前滚；落后的 legacy 数据永远不能重新成为权威。
 */
export function planConversationRecovery(
  request: ConversationRecoveryRequest
): ConversationRecoveryPlan {
  if (request.dataFlow === "canonical-to-legacy")
    throw new Error("禁止 canonical → legacy 反向同步")

  const canonicalWritesExist = request.firstCanonicalWriteAt !== null
  if (!canonicalWritesExist) {
    if (request.requestedAction !== "abort-before-canonical-write")
      throw new Error("首个 canonical 写入前只能执行 cutover abort")
    if (request.targetAuthority !== "legacy")
      throw new Error("cutover abort 的目标 authority 必须是 legacy")
    if (request.dataFlow !== "none")
      throw new Error("cutover abort 不允许复制业务数据")
    if (request.backup && request.backup.kind !== "legacy")
      throw new Error("cutover abort 只能引用已验证的 legacy 备份")
    return {
      mode: "pre-write-abort",
      targetAuthority: "legacy",
      maintenanceMode: "read-only",
      dataFlow: "none",
      steps: [
        "保持全局 read-only",
        "确认 canonical 写入计数仍为零",
        "将 server/client authority 原子恢复为 legacy epoch",
        "重新运行 legacy 完整性与计费审计后再决定开放写入",
      ],
      forbidden: ["canonical → legacy 同步", "恢复未验证备份", "绕过维护窗口"],
    }
  }

  if (request.currentAuthority !== "canonical")
    throw new Error("存在 canonical 写入后 currentAuthority 必须保持 canonical")
  if (request.targetAuthority !== "canonical")
    throw new Error("存在 canonical 写入后禁止恢复 legacy authority")
  if (request.requestedAction === "abort-before-canonical-write")
    throw new Error("存在 canonical 写入后不能执行 pre-write abort")
  if (
    request.requestedAction === "restore-canonical-backup" &&
    request.backup?.kind !== "canonical"
  )
    throw new Error("恢复操作必须引用已验证的 canonical 备份")
  if (
    request.requestedAction === "deploy-forward-fix" &&
    request.backup?.kind === "legacy"
  )
    throw new Error("前滚修复不得引用 legacy 备份作为恢复源")

  return {
    mode: "post-write-forward-recovery",
    targetAuthority: "canonical",
    maintenanceMode: "read-only",
    dataFlow:
      request.requestedAction === "restore-canonical-backup"
        ? "canonical-to-canonical"
        : "none",
    steps: [
      "保持 canonical authority 并进入全局 read-only",
      "停止新命令和 Generation，等待 checkpoint/outbox/计费收敛",
      request.requestedAction === "restore-canonical-backup"
        ? "恢复已验证的 canonical 备份并重放允许的 canonical 事件"
        : "部署前滚修复，不改写 legacy 数据",
      "运行 canonical 完整性、HTTP、Generation 与账单审计",
      "使用新 cutover epoch 恢复 canonical 流量",
    ],
    forbidden: [
      "canonical → legacy 同步",
      "恢复 legacy 备份为权威",
      "重新启用 branch-tree 写入",
      "沿用发生故障的 cutover epoch",
    ],
  }
}
