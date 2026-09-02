/**
 * core/use-thread-store —— core 层唯一的 React 绑定文件。
 *
 * store 是「稳定对象 + 原地修改 + version 递增」模型，state 引用永远不变，
 * 因此快照取 version（数字）而非 state 本身：mutate → version++ → 订阅组件重渲，
 * 渲染时再从 store.getState() 读最新树。服务端快照同样取 version（首渲为 0），
 * 与客户端首渲一致，不会产生 hydration mismatch。
 */

import { useSyncExternalStore } from "react"
import { useStore } from "zustand"
import type { ConversationStore } from "./store"
import type { NormalizedThreadChatState } from "./types"
import type { ThreadTreeState } from "./types"

export interface ThreadTreeReadableStore {
  subscribe(listener: () => void): () => void
  getVersion(): number
  getState(): ThreadTreeState
  setThreadModel(threadId: string, modelId: string): void
}

export function useThreadStore(store: ThreadTreeReadableStore): number {
  return useSyncExternalStore(
    store.subscribe,
    store.getVersion,
    store.getVersion
  )
}

export function useConversationStore<T>(
  store: ConversationStore,
  selector: (state: NormalizedThreadChatState) => T
): T {
  return useStore(store, selector)
}
