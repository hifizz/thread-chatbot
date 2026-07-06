"use client"

import { type FC, useEffect, useState } from "react"
import { ThreadPrimitive, useAuiState } from "@assistant-ui/react"
import { useShallow } from "zustand/shallow"
import { SparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { resolveServerId } from "@/lib/chat/attachment-adapter"

// 冷启动引导：composer 里挂上就绪的 PDF 后，展示自动生成的摘要 + 建议问题。
// 点击建议问题会连同 PDF 一起发送（ThreadPrimitive.Suggestion 操作当前 composer）。

type Insights = { summary: string; suggestedQuestions: string[] }

/** 读取 composer 里第一个 PDF 附件的客户端 id（多 PDF 场景下只引导第一个，保持简洁） */
function useFirstPdfAttachmentId(): string | undefined {
  return useAuiState(
    useShallow((s) => {
      const pdf = s.composer.attachments.find(
        (a) =>
          a.contentType === "application/pdf" && a.status.type !== "incomplete"
      )
      return pdf?.id
    })
  )
}

export const ComposerPdfInsights: FC = () => {
  const clientId = useFirstPdfAttachmentId()
  const [insights, setInsights] = useState<Insights | null>(null)

  useEffect(() => {
    if (!clientId) {
      setInsights(null)
      return
    }
    let cancelled = false
    setInsights(null)
    ;(async () => {
      // 等直传+解析完成拿到服务端 id，再请求洞察（首次会触发生成并缓存）
      const serverId = await resolveServerId(clientId)
      if (!serverId || cancelled) return
      const res = await fetch(`/api/attachments/${serverId}/insights`, {
        method: "POST",
      })
      if (!res.ok || cancelled) return
      const data = (await res.json()) as Insights
      if (cancelled) return
      if (data.summary || data.suggestedQuestions?.length) setInsights(data)
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [clientId])

  if (!clientId || !insights) return null

  return (
    <div className="mb-2 flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
      {insights.summary && (
        <div className="flex gap-2 text-muted-foreground">
          <SparklesIcon className="mt-0.5 size-4 shrink-0" />
          <p className="leading-relaxed">{insights.summary}</p>
        </div>
      )}
      {insights.suggestedQuestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {insights.suggestedQuestions.map((q, i) => (
            <ThreadPrimitive.Suggestion
              key={i}
              prompt={q}
              send
              render={
                <Button
                  variant="ghost"
                  className="h-auto rounded-full border border-border/60 px-3 py-1 text-xs font-normal whitespace-normal text-foreground hover:bg-muted"
                />
              }
            >
              {q}
            </ThreadPrimitive.Suggestion>
          ))}
        </div>
      )}
    </div>
  )
}
