import { ConversationCommandError } from "../application/conversation-command-contracts"

export type ConversationCommandApiAuthority =
  "disabled" | "isolated-test" | "canonical"

export interface ConversationCommandApiPolicy {
  readonly authority: ConversationCommandApiAuthority
  readonly legacyAuthorityEnabled: boolean
}

export function resolveConversationCommandApiPolicy(
  environment: NodeJS.ProcessEnv = process.env
): ConversationCommandApiPolicy {
  const value = environment.CONVERSATION_COMMAND_API_AUTHORITY?.trim()
  const authority: ConversationCommandApiAuthority =
    !value || value === "disabled"
      ? "disabled"
      : value === "isolated-test" || value === "canonical"
        ? value
        : (() => {
            throw new Error(`未知 CONVERSATION_COMMAND_API_AUTHORITY：${value}`)
          })()
  return {
    authority,
    legacyAuthorityEnabled:
      environment.BRANCH_TREE_AUTHORITY_ENABLED !== "false",
  }
}

export function assertConversationCommandApiEnabled(
  policy: ConversationCommandApiPolicy
): void {
  if (policy.authority === "disabled")
    throw new ConversationCommandError(
      "not_found",
      "规范 Conversation Command API 尚未启用"
    )
  if (
    policy.authority === "isolated-test" &&
    process.env.NODE_ENV === "production"
  )
    throw new ConversationCommandError(
      "not_found",
      "生产环境不能启用 isolated-test Conversation API"
    )
  if (policy.authority === "canonical" && policy.legacyAuthorityEnabled)
    throw new ConversationCommandError(
      "state_conflict",
      "规范命令不能与遗留整树写入权威同时启用"
    )
}
