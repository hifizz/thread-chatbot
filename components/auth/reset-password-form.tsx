"use client"

import { localizeError } from "@/lib/i18n/errors"
import { useI18n } from "@/lib/i18n/client"
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
  const { locale, t } = useI18n()
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
        toast.error(localizeError(locale, res.error))
        return
      }
      toast.success(t("auth.resetSuccess"))
      router.push("/sign-in")
    } catch {
      toast.error(t("errors.network"))
    } finally {
      setLoading(false)
    }
  }

  const invalid = !token || linkError

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t("auth.newPasswordTitle")}</CardTitle>
        <CardDescription>
          {invalid
            ? t("auth.invalidReset")
            : t("auth.resetDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!invalid && (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">{t("auth.newPassword")}</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.passwordPlaceholder")}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={loading} className="mt-1 w-full">
              {loading ? t("auth.submitting") : t("email.resetAction")}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link
            href={invalid ? "/forgot-password" : "/sign-in"}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {invalid ? t("auth.resendReset") : t("auth.backSignIn")}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
