"use client"

import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react"
import { useChatRuntime } from "@assistant-ui/react-ai-sdk"
import { Base } from "@/components/examples/base"
import { AssistantTools } from "@/components/assistant-ui/tools"
import { postgresThreadListAdapter } from "@/lib/chat/thread-list-adapter"
import { usePostgresThreadHistoryAdapter } from "@/lib/chat/use-thread-history-adapter"

function useMyChatRuntime() {
  const history = usePostgresThreadHistoryAdapter()
  return useChatRuntime({ adapters: { history } })
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
