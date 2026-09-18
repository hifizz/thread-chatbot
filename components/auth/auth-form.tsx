"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { authClient, signIn, signUp, useSession } from "@/lib/auth/client"
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
import { GoogleIcon } from "@/components/auth/google-icon"
import { localizeError } from "@/lib/i18n/errors"
import { useI18n } from "@/lib/i18n/client"
import { safeReturnPath } from "@/lib/http/return-path"
import { DEFAULT_AUTHED_REDIRECT } from "@/constants/routes"

type Mode = "sign-in" | "sign-up"


export function AuthForm({
  mode,
  googleEnabled = false,
}: {
  mode: Mode
  // 由服务端页面下传（客户端读不到 GOOGLE_CLIENT_ID 等服务端密钥）。
  googleEnabled?: boolean
}) {
  const { locale, t } = useI18n()
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
    title: t("common.signIn"),
    desc: t("auth.signInDescription"),
    submit: t("common.signIn"),
    alt: t("auth.noAccount"),
    altHref: "/sign-up",
    altLabel: t("auth.goSignUp"),
  },
  "sign-up": {
    title: t("common.signUp"),
    desc: t("auth.signUpDescription"),
    submit: t("common.signUp"),
    alt: t("auth.hasAccount"),
    altHref: "/sign-in",
    altLabel: t("auth.goSignIn"),
  },
}

  const router = useRouter()
  const params = useSearchParams()
  const redirect = safeReturnPath(params.get("redirect"), DEFAULT_AUTHED_REDIRECT)
  const copy = COPY[mode]

  // 兜底跳转：中间件不再乐观弹走带 cookie 的访问，改由这里用「真会话」判定——
  // useSession 会真查 /api/auth/get-session，确属已登录才跳走；失效 cookie 返回 null，
  // 用户留在登录页正常重登（避免死循环）。
  const { data: session } = useSession()
  useEffect(() => {
    if (session) router.replace(redirect)
  }, [session, redirect, router])

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")
  // 强制重挂 Turnstile 以获取新 token（token 单次有效，失败后需刷新）
  const [captchaKey, setCaptchaKey] = useState(0)
  const [awaitingVerify, setAwaitingVerify] = useState(false)
  const [agreed, setAgreed] = useState(false)

  function resetCaptcha() {
    setCaptchaToken("")
    setCaptchaKey((k) => k + 1)
  }

  // 带上人机验证 token（供 better-auth captcha 插件校验）
  const fetchOptions = turnstileEnabled
    ? { headers: { "x-captcha-response": captchaToken } }
    : undefined

  async function signInWithGoogle() {
    setLoading(true)
    try {
      // 跳转到 Google 授权页；回来后 better-auth 建会话并跳回 callbackURL。
      await authClient.signIn.social({
        provider: "google",
        callbackURL: redirect,
      })
    } catch {
      toast.error(t("auth.googleFailed"))
      setLoading(false)
    }
    // 成功时浏览器已在跳转途中，无需复位 loading。
  }

  async function resendVerification() {
    try {
      await authClient.sendVerificationEmail({ email, callbackURL: redirect })
      toast.success(t("auth.verificationSent"))
    } catch {
      toast.error(t("auth.sendFailed"))
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === "sign-up" && !agreed) {
      toast.error(t("auth.acceptPolicies"))
      return
    }
    if (turnstileEnabled && !captchaToken) {
      toast.error(t("auth.completeCaptcha"))
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
        toast.error(localizeError(locale, res.error))
        resetCaptcha()
        return
      }

      // 注册成功但未直接登录（token 为空）→ 需邮箱验证
      if (mode === "sign-up" && res.data && !res.data.token) {
        setAwaitingVerify(true)
        return
      }

      toast.success(mode === "sign-up" ? t("auth.signUpSuccess") : t("auth.signInSuccess"))
      router.push(redirect)
      router.refresh()
    } catch {
      toast.error(t("errors.network"))
      resetCaptcha()
    } finally {
      setLoading(false)
    }
  }

  if (awaitingVerify) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("auth.verifyTitle")}</CardTitle>
          <CardDescription>
            {t("auth.verifyDescription", { email })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            variant="outline"
            onClick={resendVerification}
            className="w-full"
          >
            {t("auth.resend")}</Button>
          <Link
            href="/sign-in"
            className="text-center text-sm text-muted-foreground hover:text-foreground"
          >
            {t("auth.backSignIn")}</Link>
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
        {googleEnabled && (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={signInWithGoogle}
              className="w-full"
            >
              <GoogleIcon className="size-4" />
              {t("auth.google", { action: copy.submit })}
            </Button>
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t("auth.or")}<span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {mode === "sign-up" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">{t("auth.nickname")}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("auth.nicknamePlaceholder")}
                autoComplete="nickname"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t("common.email")}</Label>
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
              <Label htmlFor="password">{t("common.password")}</Label>
              {mode === "sign-in" && (
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("auth.forgotPassword")}</Link>
              )}
            </div>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.passwordPlaceholder")}
              autoComplete={
                mode === "sign-up" ? "new-password" : "current-password"
              }
            />
          </div>
          {mode === "sign-up" && (
            <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 size-3.5 shrink-0"
              />
              <span>
                {t("auth.acceptPrefix")}{" "}
                <Link
                  href="/terms"
                  target="_blank"
                  className="text-foreground underline underline-offset-4"
                >
                  {t("common.terms")}</Link>{" "}
                {t("auth.and")}{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  className="text-foreground underline underline-offset-4"
                >
                  {t("common.privacy")}</Link>
              </span>
            </label>
          )}
          {turnstileEnabled && (
            <TurnstileWidget key={captchaKey} onToken={setCaptchaToken} />
          )}
          <Button type="submit" disabled={loading} className="mt-1 w-full">
            {loading ? t("common.processing") : copy.submit}
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
        <div className="mt-4 flex justify-center gap-3 text-xs text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground">
            {t("common.terms")}</Link>
          <Link href="/privacy" className="hover:text-foreground">
            {t("common.privacy")}</Link>
          <Link href="/refund" className="hover:text-foreground">
            {t("common.refund")}</Link>
        </div>
      </CardContent>
    </Card>
  )
}
