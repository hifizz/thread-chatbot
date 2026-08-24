import { CanonicalGenerationServiceError } from "../application/conversation-generation-service"
import { resolveConversationAuthority } from "../cutover/conversation-authority"

export type CanonicalGenerationAuthority =
  "disabled" | "isolated-test" | "canonical"

export interface CanonicalGenerationPolicy {
  readonly authority: CanonicalGenerationAuthority
  readonly legacyAuthorityEnabled: boolean
}

export function resolveCanonicalGenerationPolicy(
  environment: NodeJS.ProcessEnv = process.env
): CanonicalGenerationPolicy {
  const deployment = resolveConversationAuthority(environment)
  return {
    authority: deployment.isolatedTest ? "isolated-test" : "canonical",
    legacyAuthorityEnabled: false,
  }
}

export function assertCanonicalGenerationEnabled(
  policy: CanonicalGenerationPolicy
): void {
  if (policy.authority === "disabled")
    throw new CanonicalGenerationServiceError(
      "forbidden",
      "规范 Generation 生命周期默认关闭"
    )
  if (
    policy.authority === "isolated-test" &&
    process.env.NODE_ENV === "production"
  )
    throw new CanonicalGenerationServiceError(
      "forbidden",
      "生产环境不能启用 isolated-test Generation authority"
    )
  if (policy.authority === "canonical" && policy.legacyAuthorityEnabled)
    throw new CanonicalGenerationServiceError(
      "forbidden",
      "同一次执行不能同时启用规范与已退役 Generation 权威"
    )
}
