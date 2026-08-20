import { hasRenderableAssistantOutput } from "../../core/selectors"
import { defaultBranchTitle } from "../../core/store"
import type { Thread, ThreadTreeState } from "../../core/types"
import { serializeMessageForModel } from "../prompt/message-serialization"
import type { ThreadTitleInput } from "./thread-title"

export interface ThreadTitleCandidate {
  threadId: string
  input: ThreadTitleInput
}

function mainTitleCandidate(thread: Thread): ThreadTitleCandidate | null {
  if (thread.id !== "main" || thread.titleGenerationAttempted) return null
  const firstUserMessage = thread.messages.find(
    (message) => message.role === "user" && message.text.trim()
  )
  if (!firstUserMessage) return null
  return {
    threadId: thread.id,
    input: { kind: "main", question: firstUserMessage.text },
  }
}

function branchTitleCandidate(
  state: ThreadTreeState,
  thread: Thread
): ThreadTitleCandidate | null {
  if (!thread.parentId || !thread.anchorText) return null
  if (thread.titleGenerationAttempted) return null
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
      kind: "branch",
      anchorText: thread.anchorText,
      question: question.text,
      answer: serializeMessageForModel(state, answer) ?? answer.text,
    },
  }
}

export function threadTitleCandidate(
  state: ThreadTreeState,
  thread: Thread
): ThreadTitleCandidate | null {
  return thread.id === "main"
    ? mainTitleCandidate(thread)
    : branchTitleCandidate(state, thread)
}
