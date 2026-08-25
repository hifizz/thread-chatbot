/**
 * 只读 UI 投影 Store。
 *
 * 规范化 `ThreadChatProjectStore` 是唯一领域权威；这个适配器只让既有 Canvas 组件读取
 * 投影树，并允许 `/new` 草稿在提交前切换展示模型。它不创建实体 ID、不写回整棵树、
 * 不发起网络请求，也不承载 Message/Thread 变更。
 */

import type { ThreadTreeState } from "./types"

export interface ThreadStore {
  getState(): ThreadTreeState
  getVersion(): number
  subscribe(listener: () => void): () => void
  setThreadModel(threadId: string, modelId: string): void
}

export function createThreadStore(
  seed: ThreadTreeState,
  isValidModelId: (modelId: string) => boolean = () => true
): ThreadStore {
  const state = structuredClone(seed)
  let version = 0
  const listeners = new Set<() => void>()

  return {
    getState: () => state,
    getVersion: () => version,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setThreadModel(threadId, modelId) {
      const thread = state.threads[threadId]
      if (!thread || !isValidModelId(modelId) || thread.modelId === modelId)
        return
      thread.modelId = modelId
      version++
      listeners.forEach((listener) => listener())
    },
  }
}
