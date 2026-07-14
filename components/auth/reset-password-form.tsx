"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
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

export function ResetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  // better-auth 重置链接回跳时带 token（也可能带 error=invalid_token）
  const token = params.get("token") ?? ""
  const linkError = params.get("error")

  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (res.error) {
        toast.error(res.error.message || "重置失败，链接可能已失效")
        return
      }
      toast.success("密码已重置，请用新密码登录")
      router.push("/sign-in")
    } catch {
      toast.error("网络错误，请稍后重试")
    } finally {
      setLoading(false)
    }
  }

  const invalid = !token || linkError

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>设置新密码</CardTitle>
        <CardDescription>
          {invalid
            ? "链接无效或已过期，请重新发起找回密码。"
            : "输入新的登录密码。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!invalid && (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">新密码</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={loading} className="mt-1 w-full">
              {loading ? "提交中…" : "重置密码"}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link
            href={invalid ? "/forgot-password" : "/sign-in"}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {invalid ? "重新找回密码" : "返回登录"}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
