import { ConversationCommandError } from "../application/conversation-command-contracts"
import { resolveConversationAuthority } from "../cutover/conversation-authority"

export type ConversationCommandApiAuthority =
  "disabled" | "isolated-test" | "canonical"

export interface ConversationCommandApiPolicy {
  readonly authority: ConversationCommandApiAuthority
  readonly legacyAuthorityEnabled: boolean
}

export function resolveConversationCommandApiPolicy(
  environment: NodeJS.ProcessEnv = process.env
): ConversationCommandApiPolicy {
  const deployment = resolveConversationAuthority(environment)
  return {
    authority:
      deployment.authority === "canonical"
        ? deployment.isolatedTest
          ? "isolated-test"
          : "canonical"
        : "disabled",
    legacyAuthorityEnabled: deployment.authority === "legacy",
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
