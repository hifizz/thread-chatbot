import { GENERATION_CANCEL_REASONS } from "@/constants/generation"

export type GenerationCancelReason =
  (typeof GENERATION_CANCEL_REASONS)[keyof typeof GENERATION_CANCEL_REASONS]

/**
 * 用标准 AbortError 承载应用取消原因，使 Fetch、AI SDK 与工具执行链使用同一语义。
 */
export function createGenerationAbortError(
  reason: GenerationCancelReason
): DOMException {
  return new DOMException(reason, "AbortError")
}

export function abortGeneration(
  controller: AbortController,
  reason: GenerationCancelReason
): void {
  if (controller.signal.aborted) return
  controller.abort(createGenerationAbortError(reason))
}

/** 任何 fallback / retry 之前都必须先调用，取消不能被恢复成另一条模型调用。 */
export function throwIfGenerationCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  throw new DOMException(
    typeof reason === "string" ? reason : "generation-cancelled",
    "AbortError"
  )
}
