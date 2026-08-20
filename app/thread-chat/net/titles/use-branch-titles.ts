"use client"

import { useEffect, useRef } from "react"
import { BRANCH_TITLE_ATTEMPT_STORAGE_KEY_PREFIX } from "@/constants/thread-chat"
import type { ThreadStore } from "../../core/store"
import { requestBranchTitle } from "./branch-title"
import { branchTitleCandidate } from "./branch-title-candidate"

function attemptStorageKey(treeId: string, threadId: string): string {
  return `${BRANCH_TITLE_ATTEMPT_STORAGE_KEY_PREFIX}${treeId}:${threadId}`
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

export function useBranchTitles({
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
      const candidate = branchTitleCandidate(state, thread)
      if (!candidate) continue

      if (!store.markTitleGenerationAttempted(candidate.threadId)) continue
      requestedThreadIdsRef.current.add(candidate.threadId)
      rememberAttemptInCurrentTab(treeId, candidate.threadId)
      void requestBranchTitle(candidate.input)
        .then((title) => {
          if (title) store.setThreadTitle(candidate.threadId, title)
        })
        .catch((error) => {
          console.warn(
            "[thread-chat] 分支标题生成失败（保留默认标题）：",
            error
          )
        })
    }
  }, [treeId, version, store])
}
