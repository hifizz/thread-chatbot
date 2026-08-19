"use client"

import { useEffect, useState } from "react"
import { isThreadChatModelId } from "@/constants/model"
import { createThreadStore } from "../core/store"
import { useThreadStore } from "../core/use-thread-store"
import type {
  MessageFeedbackSummary,
  ThreadTreeState,
} from "../core/types"
import type { GenerationSummary, RecoverableTurn } from "../generation/types"
import { useGenerationReconciliation } from "../generation/use-generation-reconciliation"
import { useMessageActions } from "../chat/use-message-actions"
import { createChatController } from "../net/chat-controller"
import {
  deriveTreeTitle,
  saveTreeStrict,
  TreeRevisionError,
} from "../net/persist"
import { useBranchTitles } from "../net/use-branch-titles"
import { useTreePersistence } from "../net/use-tree-persistence"

/**
 * 页面壳使用的 thread-chat 运行时组合根：store、命令、generation 协调与持久化
 * 在这里接线，视图只消费组合后的能力。
 */
export function useThreadChatRuntime({
  treeId,
  initialState,
  initialGenerations,
  initialMessageFeedbacks,
  initialRecoverableTurns,
  onToast,
}: {
  treeId: string
  initialState: ThreadTreeState
  initialGenerations: GenerationSummary[]
  initialMessageFeedbacks: MessageFeedbackSummary[]
  initialRecoverableTurns: RecoverableTurn[]
  onToast: (message: string) => void
}) {
  const [store] = useState(() =>
    createThreadStore(initialState, isThreadChatModelId)
  )
  const version = useThreadStore(store)
  const state = store.getState()
  const reloadAfterRevisionConflict = () => {
    onToast("其他标签页已更新，正在重新加载…")
    window.location.reload()
  }

  const [chat] = useState(() =>
    createChatController(store, {
      treeId,
      persistNow: () => {
        const current = store.getState()
        return saveTreeStrict(treeId, current, deriveTreeTitle(current)).catch(
          (error) => {
            if (error instanceof TreeRevisionError)
              reloadAfterRevisionConflict()
            throw error
          }
        )
      },
      onError: onToast,
    })
  )
  const {
    messageActionState,
    messageCommands,
    registerRecoverableTurn,
  } = useMessageActions({
    state,
    version,
    initialRecoverableTurns,
    initialMessageFeedbacks,
    commands: chat,
  })
  useGenerationReconciliation({
    store,
    version,
    initialGenerations,
    registerRecoverableTurn,
  })
  useEffect(() => () => chat.detachAll(), [chat])

  const { setTreeSaveSuppressed, isTreeSaveSuppressed } = useTreePersistence({
    treeId,
    store,
    version,
    onRevisionConflict: reloadAfterRevisionConflict,
  })
  useBranchTitles({ store, version })

  return {
    store,
    state,
    chat,
    messageActionState,
    messageCommands,
    setTreeSaveSuppressed,
    isTreeSaveSuppressed,
  }
}
