"use client"

import { useEffect, useRef } from "react"
import { THREAD_TITLE_ATTEMPT_STORAGE_KEY_PREFIX } from "@/constants/thread-chat"
import type { ThreadStore } from "../../core/store"
import { requestThreadTitle } from "./thread-title"
import { threadTitleCandidate } from "./thread-title-candidate"

function attemptStorageKey(treeId: string, threadId: string): string {
  return `${THREAD_TITLE_ATTEMPT_STORAGE_KEY_PREFIX}${treeId}:${threadId}`
}

function hasAttemptInCurrentTab(treeId: string, threadId: string): boolean {
  try {
    return sessionStorage.getItem(attemptStorageKey(treeId, threadId)) === "1"
  } catch {
    return false
  }
}

function rememberAttemptInCurrentTab(treeId: string, threadId: string): void {
  try {
    sessionStorage.setItem(attemptStorageKey(treeId, threadId), "1")
  } catch {
    // sessionStorage 被禁用时，仍由持久化到树状态的标记防重。
  }
}

/** 主线与分支都只自动生成一次标题；主线首条用户消息可立即触发。 */
export function useThreadTitles({
  treeId,
  store,
  version,
}: {
  treeId: string
  store: ThreadStore
  version: number
}) {
  const requestedThreadIdsRef = useRef(new Set<string>())

  useEffect(() => {
    const state = store.getState()
    for (const thread of Object.values(state.threads)) {
      if (requestedThreadIdsRef.current.has(thread.id)) continue
      if (hasAttemptInCurrentTab(treeId, thread.id)) continue
      const candidate = threadTitleCandidate(state, thread)
      if (!candidate) continue

      if (!store.markTitleGenerationAttempted(candidate.threadId)) continue
      requestedThreadIdsRef.current.add(candidate.threadId)
      rememberAttemptInCurrentTab(treeId, candidate.threadId)
      void requestThreadTitle(candidate.input)
        .then((title) => {
          if (title) store.setGeneratedThreadTitle(candidate.threadId, title)
        })
        .catch((error) => {
          console.warn(
            "[thread-chat] 会话标题生成失败（保留回退标题）：",
            error
          )
        })
    }
  }, [treeId, version, store])
}
