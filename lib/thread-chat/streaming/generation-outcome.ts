import type { FinishReason, UIMessageStreamOutcome } from "ai"
import type { RequestedTerminalStatus } from "@/lib/thread-chat/streaming/finalize"

export interface GenerationTerminalOutcome {
  status: RequestedTerminalStatus
  failed: boolean
}

/**
 * 应用主动取消拥有最高优先级；SDK chunk 只提供辅助证据，不能把取消改写成失败。
 */
export function resolveGenerationTerminalOutcome(input: {
  signal: AbortSignal
  pipelineAborted: boolean
  sdkOutcome?: UIMessageStreamOutcome
  thrown: unknown | null
  protocolError: unknown | null
  finishReason?: FinishReason
}): GenerationTerminalOutcome {
  if (input.signal.aborted || input.pipelineAborted) {
    return { status: "stopped", failed: false }
  }
  if (input.sdkOutcome?.status === "aborted") {
    return { status: "stopped", failed: false }
  }
  if (input.thrown !== null || input.sdkOutcome?.status === "failed") {
    return { status: "failed", failed: true }
  }
  const failed =
    input.finishReason === "error" ||
    (input.protocolError !== null && input.sdkOutcome?.status !== "completed")
  return {
    status: failed ? "failed" : "completed",
    failed,
  }
}
