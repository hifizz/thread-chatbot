import { ConversationRepositoryError } from "../application/conversation-repository"

export type CanonicalPersistenceWriteMode =
  "disabled" | "isolated-test" | "canonical"

export interface CanonicalPersistencePolicy {
  readonly writeMode: CanonicalPersistenceWriteMode
  readonly legacyWritesEnabled: boolean
}

export function resolveCanonicalPersistencePolicy(
  environment: NodeJS.ProcessEnv = process.env
): CanonicalPersistencePolicy {
  const configured = environment.CONVERSATION_PERSISTENCE_WRITE_MODE?.trim()
  const writeMode: CanonicalPersistenceWriteMode =
    configured === undefined || configured === ""
      ? "disabled"
      : configured === "disabled" ||
          configured === "isolated-test" ||
          configured === "canonical"
        ? configured
        : (() => {
            throw new ConversationRepositoryError(
              "canonical_writes_disabled",
              `未知 CONVERSATION_PERSISTENCE_WRITE_MODE：${configured}`
            )
          })()

  return {
    writeMode,
    legacyWritesEnabled:
      environment.THREAD_TREE_LEGACY_WRITES_ENABLED !== "false",
  }
}

export function assertCanonicalWriteAllowed(
  policy: CanonicalPersistencePolicy
): void {
  if (policy.writeMode === "disabled")
    throw new ConversationRepositoryError(
      "canonical_writes_disabled",
      "规范 Conversation 仓储默认只读；必须显式声明写入模式"
    )
  if (
    policy.writeMode === "isolated-test" &&
    process.env.NODE_ENV === "production"
  )
    throw new ConversationRepositoryError(
      "canonical_writes_disabled",
      "生产环境不能启用 isolated-test 规范写入模式"
    )
  if (policy.writeMode === "canonical" && policy.legacyWritesEnabled)
    throw new ConversationRepositoryError(
      "dual_write_forbidden",
      "规范写入与遗留整树写入不能同时启用"
    )
}
