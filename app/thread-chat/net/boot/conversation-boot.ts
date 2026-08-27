import type { ConversationStore } from "../../core/store"
import type { ThreadChatClient } from "../client"
import {
  loadWorkspaceState,
  saveWorkspaceState,
} from "../persistence/workspace-state"
import {
  pollBackgroundGeneration,
  type GenerationConnection,
} from "../stream/generation-connection"

export interface ConversationBootHandle {
  background: GenerationConnection[]
  dispose(): void
}

export async function bootConversationProject(options: {
  projectId: string
  store: ConversationStore
  client: ThreadChatClient
  storage?: Storage
  pollDelays?: readonly number[]
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<ConversationBootHandle> {
  const { projectId, store, client } = options
  const bootstrap = await client.getProject(projectId)
  store.getState().hydrateProject(bootstrap)
  if (options.storage) {
    const workspace = loadWorkspaceState(options.storage, projectId)
    if (workspace) store.getState().setWorkspace(workspace)
  }

  async function generateTitleIfNeeded(threadId: string) {
    const thread = store.getState().threadsById[threadId]
    if (!thread || thread.titleGenerationAttempted) return
    try {
      const title = await client.generateThreadTitle(threadId)
      store.getState().upsertProject(title.project)
      store.getState().upsertThread(title.thread)
    } catch {
      // 自动标题失败不影响刷新后的生成恢复。
    }
  }

  // 刷新后的 generating 只轮询，不尝试恢复进程内 SSE。
  const background = bootstrap.activeGenerationIds.map((messageId) =>
    pollBackgroundGeneration({
      store,
      client,
      messageId,
      onFinishMessage: (message) => generateTitleIfNeeded(message.threadId),
      pollDelays: options.pollDelays,
      wait: options.wait,
    })
  )
  const unsubscribe = options.storage
    ? store.subscribe((state, previous) => {
        if (state.workspace !== previous.workspace)
          saveWorkspaceState(options.storage!, projectId, state.workspace)
      })
    : () => undefined

  return {
    background,
    dispose() {
      unsubscribe()
      for (const connection of background) connection.close()
    },
  }
}
