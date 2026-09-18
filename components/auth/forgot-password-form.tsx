"use client"

import { localizeError } from "@/lib/i18n/errors"
import { useI18n } from "@/lib/i18n/client"
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
  const { locale, t } = useI18n()
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
        toast.error(localizeError(locale, res.error))
        return
      }
      // 不泄露邮箱是否存在：统一显示已发送
      setSent(true)
    } catch {
      toast.error(t("errors.network"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t("auth.recoverTitle")}</CardTitle>
        <CardDescription>
          {sent
            ? t("auth.recoverSent", { email })
            : t("auth.recoverDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!sent && (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
            <Button type="submit" disabled={loading} className="mt-1 w-full">
              {loading ? t("auth.sending") : t("auth.sendReset")}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link
            href="/sign-in"
            className="font-medium text-foreground underline underline-offset-4"
          >
            {t("auth.backSignIn")}</Link>
        </p>
      </CardContent>
    </Card>
  )
}
