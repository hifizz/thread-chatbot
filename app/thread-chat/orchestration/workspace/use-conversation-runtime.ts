"use client"

import { useEffect, useMemo, useState } from "react"
import { createConversationStore } from "../../core/store"
import { createThreadChatClient } from "../../net/client"
import { createConversationCommands } from "../../net/commands/conversation-commands"
import {
  bootConversationProject,
  type ConversationBootHandle,
} from "../../net/boot/conversation-boot"

/**
 * Gate 3 的 normalized runtime。Gate 4 才会把生产入口一次性切到这里，避免
 * 同一页面同时读写旧整树 API 与 v1 API。
 */
export function useConversationRuntime(projectId: string) {
  const runtime = useMemo(() => {
    const store = createConversationStore()
    const client = createThreadChatClient()
    return {
      store,
      client,
      commands: createConversationCommands({ store, client }),
    }
  }, [])
  const [bootState, setBootState] = useState<{
    projectId: string
    status: "loading" | "ready" | "error"
    error: unknown
  }>({ projectId, status: "loading", error: null })

  useEffect(() => {
    let disposed = false
    let boot: ConversationBootHandle | null = null
    void bootConversationProject({
      projectId,
      store: runtime.store,
      client: runtime.client,
      storage: window.localStorage,
    }).then(
      (handle) => {
        if (disposed) handle.dispose()
        else {
          boot = handle
          setBootState({ projectId, status: "ready", error: null })
        }
      },
      (cause) => {
        if (!disposed) {
          setBootState({ projectId, status: "error", error: cause })
        }
      }
    )
    return () => {
      disposed = true
      boot?.dispose()
    }
  }, [projectId, runtime])

  useEffect(() => () => runtime.commands.dispose(), [runtime])
  const current =
    bootState.projectId === projectId
      ? bootState
      : { projectId, status: "loading" as const, error: null }
  return { ...runtime, status: current.status, error: current.error }
}
