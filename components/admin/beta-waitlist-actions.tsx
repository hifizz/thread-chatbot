"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function BetaWaitlistActions({
  entryId,
  approved,
}: {
  entryId: string
  approved: boolean
}) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [state, setState] = useState<"idle" | "sending" | "error">("idle")

  async function approve() {
    if (!reason.trim()) return
    const verb = approved ? "撤销旧邀请并发送新邀请" : "批准并发送邀请"
    if (!window.confirm(`确认${verb}？此操作会写入审计记录。`)) return
    setState("sending")
    try {
      const response = await fetch(`/api/admin/beta/waitlist/${entryId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      if (!response.ok) {
        setState("error")
        return
      }
      setReason("")
      setState("idle")
      router.refresh()
    } catch {
      setState("error")
    }
  }

  return (
    <div className="flex min-w-80 items-center gap-2">
      <Input
        aria-label="审核原因"
        placeholder="审核原因（必填）"
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
      />
      <Button disabled={!reason.trim() || state === "sending"} onClick={approve}>
        {state === "sending" ? "处理中…" : approved ? "重发" : "批准"}
      </Button>
      {state === "error" ? (
        <span className="text-xs text-destructive">操作失败</span>
      ) : null}
    </div>
  )
}
