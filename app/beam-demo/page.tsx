"use client"

import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { Thread } from "@/components/assistant-ui/thread"
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar"
import { AssistantTools } from "@/components/assistant-ui/tools"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useThreadChatRuntime } from "@/lib/chat/use-thread-chat-runtime"

/**
 * border-beam 风格 demo：assistant-ui 的 ThreadListSidebar（floating 变体）
 * 与 Thread 组合，侧边栏面板和 composer 都带 pulse-inner 呼吸光晕，
 * 聊天走与首页相同的完整 runtime（MiniMax 流式 + Postgres 持久化）。
 */
export default function BeamDemoPage() {
  const runtime = useThreadChatRuntime()

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantTools />
      <SidebarProvider>
        <ThreadListSidebar variant="floating" />
        <SidebarInset className="h-svh min-w-0">
          <header className="flex h-12 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger />
            <span className="text-sm font-medium">Border Beam Demo</span>
          </header>
          <div className="min-h-0 flex-1">
            <Thread />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </AssistantRuntimeProvider>
  )
}
