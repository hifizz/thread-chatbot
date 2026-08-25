"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import "./thread-chat.css"
import { useThreadChatAppRuntime } from "@/lib/thread-chat/client/providers"
import { threadChatRoutes } from "@/lib/thread-chat/api/routes"

/** 裸路径只读取服务端 Project Catalog；客户端不生成或记忆领域实体 ID。 */
export function ProjectRedirect() {
  const router = useRouter()
  const runtime = useThreadChatAppRuntime()
  useEffect(() => {
    let cancelled = false
    void runtime.commands.loadProjectCatalog({ reset: true }).then(() => {
      if (cancelled) return
      const projectId = runtime.appStore.getState().catalog.orderedProjectIds[0]
      router.replace(
        projectId
          ? threadChatRoutes.project(projectId)
          : threadChatRoutes.newProject()
      )
    })
    return () => {
      cancelled = true
    }
  }, [router, runtime])
  return (
    <div className="tc">
      <div className="boot-loading">正在打开对话…</div>
    </div>
  )
}
