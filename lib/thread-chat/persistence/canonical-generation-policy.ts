import { CanonicalGenerationServiceError } from "../application/conversation-generation-service"

export type CanonicalGenerationAuthority =
  "disabled" | "isolated-test" | "canonical"

export interface CanonicalGenerationPolicy {
  readonly authority: CanonicalGenerationAuthority
  readonly legacyAuthorityEnabled: boolean
}

export function resolveCanonicalGenerationPolicy(
  environment: NodeJS.ProcessEnv = process.env
): CanonicalGenerationPolicy {
  const value = environment.CONVERSATION_GENERATION_AUTHORITY?.trim()
  const authority: CanonicalGenerationAuthority =
    !value || value === "disabled"
      ? "disabled"
      : value === "isolated-test" || value === "canonical"
        ? value
        : (() => {
            throw new Error(`未知 CONVERSATION_GENERATION_AUTHORITY：${value}`)
          })()
  return {
    authority,
    legacyAuthorityEnabled:
      environment.BRANCH_GENERATION_AUTHORITY_ENABLED !== "false",
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
      "同一次执行不能同时启用规范与 branch_generations 权威"
    )
}
