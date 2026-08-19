import { hasRenderableAssistantOutput } from "../core/selectors"
import { defaultBranchTitle } from "../core/store"
import type { Thread, ThreadTreeState } from "../core/types"
import { serializeMessageForModel } from "./message-serialization"
import type { BranchTitleInput } from "./branch-title"

export interface BranchTitleCandidate {
  threadId: string
  input: BranchTitleInput
}

export function branchTitleCandidate(
  state: ThreadTreeState,
  thread: Thread
): BranchTitleCandidate | null {
  if (!thread.parentId || !thread.anchorText) return null
  if (thread.title !== defaultBranchTitle(thread.anchorText)) return null

  const question = thread.messages.find((message) => message.role === "user")
  const answer = thread.messages.find(
    (message) =>
      message.role === "assistant" &&
      message.status === "done" &&
      hasRenderableAssistantOutput(state, message)
  )
  if (!question || !answer) return null

  return {
    threadId: thread.id,
    input: {
      anchorText: thread.anchorText,
      question: question.text,
      answer: serializeMessageForModel(state, answer) ?? answer.text,
    },
  }
}
