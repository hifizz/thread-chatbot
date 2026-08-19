import type { Message, Thread, ThreadTreeState } from "../core/types"
import { parseThreadTreeState } from "../core/message-graph"
import { GENERATION_ERRORS } from "@/constants/generation"
import {
  isActiveGenerationStatus,
  type GenerationSummary,
} from "../generation/types"

/**
 * 纯函数：防御性收敛流式残留并校验 Artifact 三方关系。
 * 没有匹配 active generation 的中断 assistant 一律保留内容并转为可重试 error；
 * 绝不把部分正文或 Artifact 猜成完整回复。
 */
export function sanitizeLoadedState(
  inputState: ThreadTreeState,
  resolveModelId: (modelId: string | undefined) => string,
  activeGenerations: readonly Pick<
    GenerationSummary,
    "id" | "threadId" | "assistantMessageId" | "status"
  >[] = []
): ThreadTreeState {
  const state = parseThreadTreeState(inputState)
  let changed = false
  const activeByMessage = new Map(
    activeGenerations
      .filter((generation) => isActiveGenerationStatus(generation.status))
      .map((generation) => [
        `${generation.threadId}:${generation.assistantMessageId}`,
        generation.id,
      ])
  )
  const threads: Record<string, Thread> = {}
  const referencedArtifactIds = new Set<string>()

  for (const [id, thread] of Object.entries(state.threads)) {
    let threadChanged = false
    const messages: Message[] = []
    const modelId = resolveModelId(thread.modelId)
    threadChanged ||= modelId !== thread.modelId

    for (const message of thread.messages) {
      const validArtifactIds =
        message.role === "assistant"
          ? [...new Set(message.artifactIds ?? [])].filter((artifactId) => {
              const artifact = state.artifacts[artifactId]
              return (
                artifact?.sourceThreadId === id &&
                artifact.sourceMessageId === message.id
              )
            })
          : []
      const hadArtifactIds = (message.artifactIds?.length ?? 0) > 0
      const artifactRefsChanged =
        hadArtifactIds !== validArtifactIds.length > 0 ||
        (message.artifactIds?.length ?? 0) !== validArtifactIds.length ||
        validArtifactIds.some(
          (artifactId, index) => message.artifactIds?.[index] !== artifactId
        )
      const hasTransientGeneration = message.markdownGeneration !== undefined
      let nextMessage =
        artifactRefsChanged || hasTransientGeneration
          ? {
              ...message,
              artifactIds: validArtifactIds.length
                ? validArtifactIds
                : undefined,
              markdownGeneration: undefined,
            }
          : message

      if (
        nextMessage.role === "assistant" &&
        (nextMessage.status === "pending" || nextMessage.status === "streaming")
      ) {
        const activeGenerationId = activeByMessage.get(
          `${id}:${nextMessage.id}`
        )
        if (activeGenerationId) {
          if (
            nextMessage.generationId !== activeGenerationId ||
            nextMessage.backgroundGeneration !== true
          ) {
            nextMessage = {
              ...nextMessage,
              generationId: activeGenerationId,
              backgroundGeneration: true,
            }
            threadChanged = true
          }
          messages.push(nextMessage)
          validArtifactIds.forEach((artifactId) =>
            referencedArtifactIds.add(artifactId)
          )
        } else {
          threadChanged = true
          nextMessage = {
            ...nextMessage,
            status: "error",
            error: GENERATION_ERRORS.backgroundInterrupted,
            backgroundGeneration: undefined,
          }
          messages.push(nextMessage)
          validArtifactIds.forEach((artifactId) =>
            referencedArtifactIds.add(artifactId)
          )
        }
      } else {
        messages.push(nextMessage)
        validArtifactIds.forEach((artifactId) =>
          referencedArtifactIds.add(artifactId)
        )
      }
      threadChanged ||= artifactRefsChanged || hasTransientGeneration
    }

    threads[id] = threadChanged ? { ...thread, modelId, messages } : thread
    changed ||= threadChanged
  }

  const artifacts = Object.fromEntries(
    Object.entries(state.artifacts).filter(([artifactId]) =>
      referencedArtifactIds.has(artifactId)
    )
  )
  if (Object.keys(artifacts).length !== Object.keys(state.artifacts).length)
    changed = true

  const orderedIds = new Set<string>()
  const artifactOrder = state.artifactOrder.filter((artifactId) => {
    if (!artifacts[artifactId] || orderedIds.has(artifactId)) return false
    orderedIds.add(artifactId)
    return true
  })
  referencedArtifactIds.forEach((artifactId) => {
    if (artifacts[artifactId] && !orderedIds.has(artifactId)) {
      orderedIds.add(artifactId)
      artifactOrder.push(artifactId)
    }
  })
  if (
    artifactOrder.length !== state.artifactOrder.length ||
    artifactOrder.some(
      (artifactId, index) => artifactId !== state.artifactOrder[index]
    )
  )
    changed = true

  return changed ? { ...state, threads, artifacts, artifactOrder } : state
}
