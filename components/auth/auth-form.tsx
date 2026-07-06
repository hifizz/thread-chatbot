"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { signIn, signUp } from "@/lib/auth/client"
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

type Mode = "sign-in" | "sign-up"

const COPY: Record<
  Mode,
  {
    title: string
    desc: string
    submit: string
    alt: string
    altHref: string
    altLabel: string
  }
> = {
  "sign-in": {
    title: "登录",
    desc: "使用邮箱和密码登录你的账户",
    submit: "登录",
    alt: "还没有账户？",
    altHref: "/sign-up",
    altLabel: "去注册",
  },
  "sign-up": {
    title: "注册",
    desc: "创建账户，注册即赠送初始额度",
    submit: "注册",
    alt: "已有账户？",
    altHref: "/sign-in",
    altLabel: "去登录",
  },
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter()
  const params = useSearchParams()
  const redirect = params.get("redirect") || "/"
  const copy = COPY[mode]

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res =
        mode === "sign-up"
          ? await signUp.email({
              email,
              password,
              name: name || email.split("@")[0],
            })
          : await signIn.email({ email, password })

      if (res.error) {
        toast.error(res.error.message || "操作失败，请重试")
        return
      }
      toast.success(mode === "sign-up" ? "注册成功" : "登录成功")
      router.push(redirect)
      router.refresh()
    } catch {
      toast.error("网络错误，请稍后重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.desc}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {mode === "sign-up" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">昵称（可选）</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="你的昵称"
                autoComplete="nickname"
              />
            </div>
          )}
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
              autoComplete={
                mode === "sign-up" ? "new-password" : "current-password"
              }
            />
          </div>
          <Button type="submit" disabled={loading} className="mt-1 w-full">
            {loading ? "处理中…" : copy.submit}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {copy.alt}{" "}
          <Link
            href={copy.altHref}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {copy.altLabel}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
