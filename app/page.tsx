"use client"

import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { useChatRuntime } from "@assistant-ui/react-ai-sdk"
import { Base } from "@/components/examples/base"

export default function Page() {
  const runtime = useChatRuntime()

  return (
    <div className="h-svh w-full">
      <AssistantRuntimeProvider runtime={runtime}>
        <Base />
      </AssistantRuntimeProvider>
    </div>
  )
}
