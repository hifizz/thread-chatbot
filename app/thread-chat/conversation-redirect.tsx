"use client"
/**
 * 裸路径 /thread-chat 的入口跳板：由 canonical bootstrap 返回最近的 active
 * Conversation；首次进入时在默认 Project 下创建 Conversation。客户端不再猜 ID，
 * 也不再把 localStorage 当成事实源。
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import "./thread-chat.css"

export function ConversationRedirect() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/conversations/bootstrap", {
      method: "POST",
      headers: {
        "Idempotency-Key": `bootstrap:${crypto.randomUUID()}`,
        "X-Command-Id": crypto.randomUUID(),
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = (await response.json()) as {
          data?: { conversationId?: unknown }
          error?: { message?: unknown }
        }
        if (!response.ok || typeof value.data?.conversationId !== "string")
          throw new Error(
            typeof value.error?.message === "string"
              ? value.error.message
              : "无法打开 Conversation"
          )
        router.replace(`/thread-chat/${value.data.conversationId}`)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        console.error("[conversation-bootstrap] 裸入口失败", error)
        setError(error instanceof Error ? error.message : String(error))
      })
    return () => controller.abort()
  }, [router])
  return (
    <div className="tc">
      <div className="boot-loading" role={error ? "alert" : undefined}>
        {error ? `无法打开对话：${error}` : "正在打开对话…"}
        {error && (
          <button className="tbtn" onClick={() => location.reload()}>
            重试
          </button>
        )}
      </div>
    </div>
  )
}
