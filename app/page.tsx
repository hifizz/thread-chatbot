"use client"

import { useMemo } from "react"
import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
  type FeedbackAdapter,
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

// 点赞/点踩 → /api/feedback → Langfuse score。assistant 消息 id 即该轮 traceId
//（chat route 下发），服务端未启用遥测时该请求会被静默吞掉。fire-and-forget，
// UI 的已提交态由 assistant-ui 本地维护，不依赖请求结果。
const feedbackAdapter: FeedbackAdapter = {
  submit({ message, type }) {
    void fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: message.id, type }),
    }).catch(() => {})
  },
}

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
    adapters: {
      history,
      attachments: r2AttachmentAdapter,
      feedback: feedbackAdapter,
    },
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
