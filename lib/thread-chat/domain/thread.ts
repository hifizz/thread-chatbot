import type { BaseContextV1 } from "./base-context"
import { validateBaseContext } from "./base-context"
import { invariant } from "./domain-error"
import type { MessageId, ProjectId, ThreadId } from "./ids"
import type { Message } from "./message"

export type ForkSourceSnapshot = {
  schemaVersion: 1
  quote?: string
  sourceRole: "user" | "assistant"
  sourceSequence: number
}

export type Thread = {
  id: ThreadId
  projectId: ProjectId
  parentThreadId: ThreadId | null
  sourceMessageId: MessageId | null
  forkSourceSnapshot: ForkSourceSnapshot | null
  baseContext: BaseContextV1 | null
  autoTitle: string | null
  customTitle: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function isRootThread(thread: Thread): boolean {
  return thread.parentThreadId === null
}

export function validateThreadTopology(
  projectId: ProjectId,
  projectThreads: readonly Thread[],
  messagesById: ReadonlyMap<MessageId, Message>
): void {
  const byId = new Map(projectThreads.map((thread) => [thread.id, thread]))
  const roots = projectThreads.filter(isRootThread)
  invariant(
    roots.length === 1,
    "project_root_invalid",
    "Project 必须恰有一个 Root Thread。"
  )

  for (const thread of projectThreads) {
    invariant(
      thread.projectId === projectId,
      "thread_parent_invalid",
      "Thread 必须属于当前 Project。"
    )
    if (isRootThread(thread)) {
      invariant(
        thread.sourceMessageId === null &&
          thread.forkSourceSnapshot === null &&
          thread.baseContext === null,
        "thread_fork_facts_invalid",
        "Root Thread 不得包含 ForkFacts。"
      )
      continue
    }

    invariant(
      thread.sourceMessageId && thread.forkSourceSnapshot && thread.baseContext,
      "thread_fork_facts_invalid",
      "Branch Thread 必须包含完整 ForkFacts。"
    )
    const parent = byId.get(thread.parentThreadId!)
    invariant(
      parent?.projectId === projectId,
      "thread_parent_invalid",
      "Branch Parent 必须属于同一 Project。"
    )
    const source = messagesById.get(thread.sourceMessageId)
    invariant(
      source?.threadId === parent.id,
      "thread_source_invalid",
      "Fork source Message 必须属于 Parent Thread。"
    )
    validateBaseContext(thread.baseContext)
  }

  for (const thread of projectThreads) {
    const visited = new Set<ThreadId>()
    let cursor: Thread | undefined = thread
    while (cursor?.parentThreadId) {
      invariant(
        !visited.has(cursor.id),
        "thread_cycle",
        "Thread topology 不得形成环。"
      )
      visited.add(cursor.id)
      cursor = byId.get(cursor.parentThreadId)
    }
  }
}
