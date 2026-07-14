"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { authClient, signIn, signUp } from "@/lib/auth/client"
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
import { TurnstileWidget, turnstileEnabled } from "@/components/auth/turnstile"

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
    desc: "创建账户，验证邮箱后即赠送初始额度",
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
  const [captchaToken, setCaptchaToken] = useState("")
  // 强制重挂 Turnstile 以获取新 token（token 单次有效，失败后需刷新）
  const [captchaKey, setCaptchaKey] = useState(0)
  const [awaitingVerify, setAwaitingVerify] = useState(false)

  function resetCaptcha() {
    setCaptchaToken("")
    setCaptchaKey((k) => k + 1)
  }

  // 带上人机验证 token（供 better-auth captcha 插件校验）
  const fetchOptions = turnstileEnabled
    ? { headers: { "x-captcha-response": captchaToken } }
    : undefined

  async function resendVerification() {
    try {
      await authClient.sendVerificationEmail({ email, callbackURL: redirect })
      toast.success("验证邮件已重新发送")
    } catch {
      toast.error("发送失败，请稍后重试")
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (turnstileEnabled && !captchaToken) {
      toast.error("请先完成人机验证")
      return
    }
    setLoading(true)
    try {
      const res =
        mode === "sign-up"
          ? await signUp.email(
              { email, password, name: name || email.split("@")[0] },
              fetchOptions
            )
          : await signIn.email({ email, password }, fetchOptions)

      if (res.error) {
        toast.error(res.error.message || "操作失败，请重试")
        resetCaptcha()
        return
      }

      // 注册成功但未直接登录（token 为空）→ 需邮箱验证
      if (mode === "sign-up" && res.data && !res.data.token) {
        setAwaitingVerify(true)
        return
      }

      toast.success(mode === "sign-up" ? "注册成功" : "登录成功")
      router.push(redirect)
      router.refresh()
    } catch {
      toast.error("网络错误，请稍后重试")
      resetCaptcha()
    } finally {
      setLoading(false)
    }
  }

  if (awaitingVerify) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>验证你的邮箱</CardTitle>
          <CardDescription>
            我们已向 {email}{" "}
            发送验证邮件，点击邮件中的链接完成验证后即可登录并领取初始额度。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            variant="outline"
            onClick={resendVerification}
            className="w-full"
          >
            重新发送验证邮件
          </Button>
          <Link
            href="/sign-in"
            className="text-center text-sm text-muted-foreground hover:text-foreground"
          >
            返回登录
          </Link>
        </CardContent>
      </Card>
    )
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password">密码</Label>
              {mode === "sign-in" && (
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  忘记密码？
                </Link>
              )}
            </div>
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
          {turnstileEnabled && (
            <TurnstileWidget key={captchaKey} onToken={setCaptchaToken} />
          )}
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
