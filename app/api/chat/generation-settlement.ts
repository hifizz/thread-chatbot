import type { UIMessage } from "ai"
import type { ResearchPlan, ResearchRoute } from "@/lib/chat/research-router"
import type { ThreadChatGenerationIdentity } from "@/lib/thread-chat/contracts/generation-identity"
import { GENERATION_ERRORS } from "@/constants/generation"
import { projectGenerationResult } from "@/lib/thread-chat/application/project-generation-result"
import { finalizeGenerationWithRetry } from "@/lib/thread-chat-generation/finalize-with-retry"
import type { StreamLifecycle } from "@/app/api/chat/stream-lifecycle"

type SettlementDependencies = {
  project: typeof projectGenerationResult
  finalize: typeof finalizeGenerationWithRetry
}

const defaultDependencies: SettlementDependencies = {
  project: projectGenerationResult,
  finalize: finalizeGenerationWithRetry,
}

type GenerationSettlementInput = {
  persistence: ThreadChatGenerationIdentity
  researchRoute: ResearchRoute
  researchPlan: ResearchPlan | null
  unbilledPreview: boolean
  streamLifecycle: Pick<StreamLifecycle, "snapshot">
}

/** 将 UI stream 的结束信号投影并一次性收口到 generation 终态。 */
export function createGenerationSettlementHandler(
  {
    persistence,
    researchRoute,
    researchPlan,
    unbilledPreview,
    streamLifecycle,
  }: GenerationSettlementInput,
  dependencies: SettlementDependencies = defaultDependencies
) {
  return async ({
    responseMessage,
    isAborted,
    finishReason,
  }: {
    responseMessage: Pick<UIMessage, "parts">
    isAborted: boolean
    finishReason?: string | null
  }) => {
    const {
      capturedUsage,
      capturedProviderMetadata,
      modelStreamError,
      abortedUsageUnavailable,
    } = streamLifecycle.snapshot()
    const failedWithoutFinish =
      finishReason == null && modelStreamError !== undefined
    const requestedTerminal = isAborted
      ? "stopped"
      : failedWithoutFinish
        ? "failed"
        : "completed"
    const projected = dependencies.project({
      generationId: persistence.generationId,
      threadId: persistence.threadId,
      assistantMessageId: persistence.assistantMessageId,
      responseMessage,
      terminalStatus: requestedTerminal,
      error: modelStreamError,
      researchRoute,
      researchPlan: researchPlan ?? undefined,
      usage: capturedUsage
        ? {
            inputTokens: capturedUsage.inputTokens,
            outputTokens: capturedUsage.outputTokens,
            totalTokens: capturedUsage.inputTokens + capturedUsage.outputTokens,
            providerMetadata: capturedProviderMetadata,
          }
        : undefined,
    })
    const outcome =
      requestedTerminal === "completed" && !projected.hasDisplayableOutput
        ? "failed"
        : requestedTerminal
    await dependencies.finalize({
      generationId: persistence.generationId,
      outcome,
      result: projected.result,
      error: projected.result.error ?? modelStreamError,
      usage: unbilledPreview ? undefined : capturedUsage,
      usageUnavailable:
        !unbilledPreview &&
        (abortedUsageUnavailable ||
          (requestedTerminal !== "completed" && !capturedUsage)),
    })
  }
}

/** stream 初始化阶段抛错时，尽力保存失败终态；结算失败不覆盖原 HTTP 错误。 */
export async function settleGenerationInitializationFailure(
  {
    persistence,
    error,
    usageUnavailable,
  }: {
    persistence: ThreadChatGenerationIdentity
    error: unknown
    usageUnavailable: boolean
  },
  dependencies: SettlementDependencies = defaultDependencies
) {
  const projected = dependencies.project({
    generationId: persistence.generationId,
    threadId: persistence.threadId,
    assistantMessageId: persistence.assistantMessageId,
    responseMessage: { parts: [] },
    terminalStatus: "failed",
    error:
      error instanceof Error ? error.message : GENERATION_ERRORS.streamFailed,
  })
  try {
    await dependencies.finalize({
      generationId: persistence.generationId,
      outcome: "failed",
      result: projected.result,
      error: projected.result.error,
      usageUnavailable,
    })
  } catch (finalizeError) {
    console.error("[thread-chat-generation] 请求初始化失败后的终态保存失败", {
      generationId: persistence.generationId,
      finalizeError,
    })
  }
}
