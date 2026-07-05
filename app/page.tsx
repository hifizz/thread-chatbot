"use client"

import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react"
import { useChatRuntime } from "@assistant-ui/react-ai-sdk"
import { Base } from "@/components/examples/base"
import { AssistantTools } from "@/components/assistant-ui/tools"
import { postgresThreadListAdapter } from "@/lib/chat/thread-list-adapter"
import { usePostgresThreadHistoryAdapter } from "@/lib/chat/use-thread-history-adapter"
import { r2AttachmentAdapter } from "@/lib/chat/attachment-adapter"

function useMyChatRuntime() {
  const history = usePostgresThreadHistoryAdapter()
  return useChatRuntime({ adapters: { history, attachments: r2AttachmentAdapter } })
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
