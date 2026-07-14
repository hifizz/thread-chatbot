"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { authClient } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      })
      if (res.error) {
        toast.error(res.error.message || "发送失败，请重试")
        return
      }
      // 不泄露邮箱是否存在：统一显示已发送
      setSent(true)
    } catch {
      toast.error("网络错误，请稍后重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>找回密码</CardTitle>
        <CardDescription>
          {sent
            ? `若 ${email} 已注册，我们已发送重置密码链接，请查收邮件。`
            : "输入注册邮箱，我们会发送重置密码的链接。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!sent && (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <Button type="submit" disabled={loading} className="mt-1 w-full">
              {loading ? "发送中…" : "发送重置链接"}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link
            href="/sign-in"
            className="font-medium text-foreground underline underline-offset-4"
          >
            返回登录
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
