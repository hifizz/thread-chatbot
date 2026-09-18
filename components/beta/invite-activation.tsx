"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function InviteActivation({ token }: { token: string }) {
  const router = useRouter()
  const [state, setState] = useState<"idle" | "sending" | "error">("idle")
  const [message, setMessage] = useState("")

  async function activate() {
    setState("sending")
    try {
      const response = await fetch("/api/beta/invites/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const body = (await response.json()) as {
        error?: { message?: string }
      }
      if (!response.ok) {
        setMessage(body.error?.message ?? "邀请激活失败")
        setState("error")
        return
      }
      router.replace("/thread-chat")
      router.refresh()
    } catch {
      setMessage("网络异常，请稍后重试")
      setState("error")
    }
  }

  return (
    <div className="mt-8">
      <Button className="h-10 w-full" disabled={state === "sending"} onClick={activate}>
        {state === "sending" ? "正在激活…" : "确认激活私测资格"}
      </Button>
      <p aria-live="polite" className="mt-3 text-sm text-destructive">
        {state === "error" ? message : ""}
      </p>
    </div>
  )
}
