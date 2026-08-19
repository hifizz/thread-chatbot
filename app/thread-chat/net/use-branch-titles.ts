"use client"

import { useEffect, useRef } from "react"
import type { ThreadStore } from "../core/store"
import { requestBranchTitle } from "./branch-title"
import { branchTitleCandidate } from "./branch-title-candidate"

export function useBranchTitles({
  store,
  version,
}: {
  store: ThreadStore
  version: number
}) {
  const requestedThreadIdsRef = useRef(new Set<string>())

  useEffect(() => {
    const state = store.getState()
    for (const thread of Object.values(state.threads)) {
      if (requestedThreadIdsRef.current.has(thread.id)) continue
      const candidate = branchTitleCandidate(state, thread)
      if (!candidate) continue

      requestedThreadIdsRef.current.add(candidate.threadId)
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
  }, [version, store])
}
