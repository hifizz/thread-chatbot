"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function WaitlistForm() {
  const [email, setEmail] = useState("")
  const [state, setState] = useState<"idle" | "sending" | "accepted" | "error">("idle")

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState("sending")
    try {
      const response = await fetch("/api/beta/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale: "zh-CN" }),
      })
      setState(response.ok ? "accepted" : "error")
      if (response.ok) setEmail("")
    } catch {
      setState("error")
    }
  }

  return (
    <form className="mt-8 space-y-3" onSubmit={submit}>
      <label className="block text-sm font-medium" htmlFor="beta-email">
        邮箱地址
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="beta-email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="h-10"
        />
        <Button className="h-10" disabled={state === "sending"} type="submit">
          {state === "sending" ? "提交中…" : "申请私测"}
        </Button>
      </div>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {state === "accepted" && "申请已收到；若获批，我们会向该邮箱发送邀请。"}
        {state === "error" && "暂时无法提交，请稍后重试。"}
        {state === "idle" && "我们不会通过响应透露该邮箱是否已经申请。"}
      </p>
    </form>
  )
}
