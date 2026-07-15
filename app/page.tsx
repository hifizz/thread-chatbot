"use client"

import { useMemo } from "react"
import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react"
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk"
import { Base } from "@/components/examples/base"
import { AssistantTools } from "@/components/assistant-ui/tools"
import { postgresThreadListAdapter } from "@/lib/chat/thread-list-adapter"
import { usePostgresThreadHistoryAdapter } from "@/lib/chat/use-thread-history-adapter"
import { r2AttachmentAdapter } from "@/lib/chat/attachment-adapter"
import { useResearchMode } from "@/lib/chat/research-mode"
import { useModelMode } from "@/lib/chat/model-mode"
import { fetchWithAuth } from "@/lib/auth/session-recovery"

function useMyChatRuntime() {
  const history = usePostgresThreadHistoryAdapter()
  // 把「深度研究」开关状态随每条消息发给 chat route。用 getState() 而非闭包快照，
  // 保证读到发送时的最新开关值。
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        // 会话失效（401）时自动登出并跳登录页，避免流式请求卡在错误态
        fetch: fetchWithAuth,
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
            // 随每条消息带上当前选中的模型（同「深度研究」开关的做法，读发送时的最新值）
            modelId: useModelMode.getState().modelId,
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

export default function Page() {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useMyChatRuntime,
    adapter: postgresThreadListAdapter,
  })

  return (
    <div className="h-svh w-full">
      <AssistantRuntimeProvider runtime={runtime}>
        <AssistantTools />
        <Base />
      </AssistantRuntimeProvider>
    </div>
  )
}
