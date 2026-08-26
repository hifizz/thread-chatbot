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
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let disposed = false
    let boot: ConversationBootHandle | null = null
    setStatus("loading")
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
          setStatus("ready")
        }
      },
      (cause) => {
        if (!disposed) {
          setError(cause)
          setStatus("error")
        }
      }
    )
    return () => {
      disposed = true
      boot?.dispose()
    }
  }, [projectId, runtime])

  useEffect(() => () => runtime.commands.dispose(), [runtime])
  return { ...runtime, status, error }
}

