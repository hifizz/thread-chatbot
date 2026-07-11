"use client"

import { useMemo } from "react"
import { useRemoteThreadListRuntime } from "@assistant-ui/react"
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk"
import { postgresThreadListAdapter } from "@/lib/chat/thread-list-adapter"
import { usePostgresThreadHistoryAdapter } from "@/lib/chat/use-thread-history-adapter"
import { r2AttachmentAdapter } from "@/lib/chat/attachment-adapter"
import { useResearchMode } from "@/lib/chat/research-mode"

function useMyChatRuntime() {
  const history = usePostgresThreadHistoryAdapter()
  // 把「深度研究」开关状态随每条消息发给 chat route。用 getState() 而非闭包快照，
  // 保证读到发送时的最新开关值。
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        prepareSendMessagesRequest: ({
          id,
          messages,
          trigger,
          messageId,
          body,
        }) => ({
          body: {
            ...body,
            id,
            messages,
            trigger,
            messageId,
            deepResearch: useResearchMode.getState().enabled,
          },
        }),
      }),
    []
  )
  return useChatRuntime({
    transport,
    adapters: { history, attachments: r2AttachmentAdapter },
  })
}

/**
 * 本项目的完整聊天 runtime：AI SDK transport + Postgres 线程列表/历史持久化。
 * 供 app/page.tsx 与各 demo 页面共用，传给 AssistantRuntimeProvider。
 */
export function useThreadChatRuntime() {
  return useRemoteThreadListRuntime({
    runtimeHook: useMyChatRuntime,
    adapter: postgresThreadListAdapter,
  })
}
