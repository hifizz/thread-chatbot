import type { Message, Thread, ThreadTreeState } from "../core/types"

/**
 * 纯函数：恢复流式残留并修复 Artifact 三方关系。
 * 有正文或有效 Artifact 的中断 assistant → done；两者皆空 → 删除。
 * message.artifactIds / registry / artifactOrder 最终只保留互相可达的数据。
 */
export function sanitizeLoadedState(state: ThreadTreeState): ThreadTreeState {
  let changed = false
  const threads: Record<string, Thread> = {}
  const referencedArtifactIds = new Set<string>()

  for (const [id, thread] of Object.entries(state.threads)) {
    let threadChanged = false
    const messages: Message[] = []

    for (const message of thread.messages) {
      const validArtifactIds =
        message.role === "assistant"
          ? [...new Set(message.artifactIds ?? [])].filter((artifactId) => {
              const artifact = state.artifacts[artifactId]
              return artifact?.sourceThreadId === id
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
        threadChanged = true
        if (nextMessage.text.trim() !== "" || validArtifactIds.length > 0) {
          nextMessage = { ...nextMessage, status: "done" }
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

    threads[id] = threadChanged ? { ...thread, messages } : thread
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
