import {
  OBSERVABILITY_POLICY_VERSIONS,
  TRACE_NAMES,
} from "@/constants/observability"
import { resolveObservabilityConfig } from "@/lib/observability/config"
import {
  assistantMessageTraceId,
  pseudonymizeUserId,
  requestTraceId,
} from "@/lib/observability/identity"
import type { AgentTraceInput } from "@/lib/observability/trace"
import type { ObservabilityContext } from "@/lib/observability/types"

let warnedMissingSalt = false

function pseudonymousUserId(
  userId: string,
  salt: string | undefined,
  enabled: boolean
): string | undefined {
  if (!enabled) return undefined
  if (salt) return pseudonymizeUserId(userId, salt)
  if (!warnedMissingSalt) {
    warnedMissingSalt = true
    console.warn(
      "[observability] AI_OBSERVABILITY_ID_SALT 未配置，不导出用户关联 ID"
    )
  }
  return undefined
}

function versionContext(): Pick<
  ObservabilityContext,
  | "promptVersion"
  | "searchPolicyVersion"
  | "memoryPolicyVersion"
  | "toolsetVersion"
  | "multimodalParserVersion"
> {
  return {
    promptVersion: OBSERVABILITY_POLICY_VERSIONS.prompt,
    searchPolicyVersion: OBSERVABILITY_POLICY_VERSIONS.search,
    memoryPolicyVersion: OBSERVABILITY_POLICY_VERSIONS.memory,
    toolsetVersion: OBSERVABILITY_POLICY_VERSIONS.toolset,
    multimodalParserVersion: OBSERVABILITY_POLICY_VERSIONS.multimodalParser,
  }
}

export async function buildThreadChatTraceInput(input: {
  userId: string
  projectId: string
  threadId: string
  assistantMessageId: string
  modelId: string
}): Promise<AgentTraceInput> {
  const config = resolveObservabilityConfig()
  const anonymousUser = pseudonymousUserId(
    input.userId,
    config.idSalt,
    config.enabled
  )
  return {
    name: TRACE_NAMES.threadChatGeneration,
    traceId: await assistantMessageTraceId(input.assistantMessageId),
    sessionId: input.projectId,
    tags: ["thread-chat", "normalized"],
    context: {
      projectId: input.projectId,
      threadId: input.threadId,
      assistantMessageId: input.assistantMessageId,
      modelId: input.modelId,
      environment: config.environment,
      release: config.release,
      entrypoint: "thread-chat",
      ...versionContext(),
      ...(anonymousUser ? { pseudonymousUserId: anonymousUser } : {}),
    },
  }
}

export async function buildLegacyChatTraceInput(input: {
  userId: string
  requestId: string
  linearThreadId?: string
  modelId: string
}): Promise<AgentTraceInput> {
  const config = resolveObservabilityConfig()
  const anonymousUser = pseudonymousUserId(
    input.userId,
    config.idSalt,
    config.enabled
  )
  return {
    name: TRACE_NAMES.legacyChatRequest,
    traceId: await requestTraceId(input.requestId),
    ...(input.linearThreadId ? { sessionId: input.linearThreadId } : {}),
    tags: ["legacy-chat"],
    context: {
      requestId: input.requestId,
      ...(input.linearThreadId ? { threadId: input.linearThreadId } : {}),
      modelId: input.modelId,
      environment: config.environment,
      release: config.release,
      entrypoint: "legacy-chat",
      ...versionContext(),
      ...(anonymousUser ? { pseudonymousUserId: anonymousUser } : {}),
    },
  }
}
