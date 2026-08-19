import type {
  Artifact,
  Message,
  ThreadTreeState,
} from "@/app/thread-chat/core/types"
import type {
  GenerationResultV1,
  GenerationTurnSnapshot,
} from "@/app/thread-chat/generation/types"

export type MergeGenerationResultInput = {
  threadId: string
  assistantMessageId: string
  generationId: string
  turnSnapshot: GenerationTurnSnapshot
  result: GenerationResultV1
}

function messageReferenceCounts(state: ThreadTreeState): Map<string, number> {
  const counts = new Map<string, number>()
  for (const thread of Object.values(state.threads)) {
    for (const message of thread.messages) {
      for (const artifactId of message.artifactIds ?? []) {
        counts.set(artifactId, (counts.get(artifactId) ?? 0) + 1)
      }
    }
  }
  return counts
}

function repairTargetMessage(
  messages: Message[],
  input: MergeGenerationResultInput
): number {
  const desiredIndex = Math.min(
    Math.max(input.turnSnapshot.assistantMessageIndex, 0),
    messages.length
  )
  const userExists = messages.some(
    (message) => message.id === input.turnSnapshot.userMessage.id
  )
  if (!userExists) {
    messages.splice(
      Math.max(0, desiredIndex - 1),
      0,
      structuredClone(input.turnSnapshot.userMessage)
    )
  }
  const repairedIndex = Math.min(
    Math.max(input.turnSnapshot.assistantMessageIndex, 0),
    messages.length
  )
  messages.splice(
    repairedIndex,
    0,
    structuredClone(input.turnSnapshot.assistantMessage)
  )
  return repairedIndex
}

/**
 * current generation patch 的幂等合并。只覆盖 generation-owned 字段，目标消息的
 * forks/quote 等并发用户编辑保持不变；不同 generationId 的晚到 patch 被 CAS 丢弃。
 */
export function mergeGenerationResult(
  state: ThreadTreeState,
  input: MergeGenerationResultInput
): ThreadTreeState {
  if (input.result.generationId !== input.generationId) return state
  const sourceThread = state.threads[input.threadId]
  if (!sourceThread) return state

  const next = structuredClone(state)
  const thread = next.threads[input.threadId]
  let messageIndex = thread.messages.findIndex(
    (message) => message.id === input.assistantMessageId
  )
  if (messageIndex === -1) {
    messageIndex = repairTargetMessage(thread.messages, input)
  }
  const message = thread.messages[messageIndex]
  if (!message || message.role !== "assistant") return state
  if (message.generationId && message.generationId !== input.generationId)
    return state

  const oldArtifactIds = message.artifactIds ?? []
  const referenceCounts = messageReferenceCounts(next)
  const newArtifactIds = [...new Set(input.result.artifactIds)]
  const newArtifacts: Record<string, Artifact> = {}
  for (const id of newArtifactIds) {
    const artifact = input.result.artifacts[id]
    if (artifact) newArtifacts[id] = structuredClone(artifact)
  }

  for (const oldId of oldArtifactIds) {
    if (!newArtifacts[oldId] && (referenceCounts.get(oldId) ?? 0) <= 1) {
      delete next.artifacts[oldId]
    }
  }
  Object.assign(next.artifacts, newArtifacts)
  next.artifactOrder = next.artifactOrder.filter(
    (id, index, all) =>
      next.artifacts[id] !== undefined && all.indexOf(id) === index
  )
  for (const id of newArtifactIds) {
    if (newArtifacts[id] && !next.artifactOrder.includes(id)) {
      next.artifactOrder.push(id)
    }
  }

  message.text = input.result.text
  message.status = input.result.status
  message.error = input.result.error
  message.generationId = input.generationId
  message.backgroundGeneration = undefined
  message.artifactIds = newArtifactIds.length ? newArtifactIds : undefined
  message.markdownGeneration = undefined
  message.webResearch = input.result.webResearch
  message.webResearchTextOffset = input.result.webResearchTextOffset
  message.researchRoute = input.result.researchRoute
  message.researchPlan = input.result.researchPlan
  return next
}
