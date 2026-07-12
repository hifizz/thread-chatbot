"use client"

import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { Base } from "@/components/examples/base"
import { AssistantTools } from "@/components/assistant-ui/tools"
import { useThreadChatRuntime } from "@/lib/chat/use-thread-chat-runtime"

export default function Page() {
  const runtime = useThreadChatRuntime()

  return (
    <div className="h-svh w-full">
      <AssistantRuntimeProvider runtime={runtime}>
        <AssistantTools />
        <Base />
      </AssistantRuntimeProvider>
    </div>
  )
}
