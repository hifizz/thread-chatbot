"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Switch } from "@/components/ui/switch"
import { useIsMobile } from "@/hooks/use-mobile"
import { useI18n } from "@/lib/i18n/client"
import { usePrivacy } from "@/lib/privacy/client"

function PreferenceBody({ analytics, setAnalytics }: {
  analytics: boolean
  setAnalytics(value: boolean): void
}) {
  const { t } = useI18n()
  return <div className="grid gap-4 py-2">
    <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
      <div>
        <p className="font-medium">{t("cookie.necessary")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("cookie.necessaryDescription")}</p>
      </div>
      <Switch checked disabled aria-label={t("cookie.necessary")} />
    </div>
    <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
      <div>
        <p className="font-medium">{t("cookie.analytics")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("cookie.analyticsDescription")}</p>
      </div>
      <Switch checked={analytics} onCheckedChange={setAnalytics} aria-label={t("cookie.analytics")} />
    </div>
    <p className="text-xs text-muted-foreground">
      <Link href="/privacy" className="underline underline-offset-2">{t("common.privacy")}</Link>
    </p>
  </div>
}

function SettingsContent() {
  const { consent, saving, saveFailed, decide, setSettingsOpen } = usePrivacy()
  const { t } = useI18n()
  const [analytics, setAnalytics] = useState(
    consent.state === "valid" && consent.snapshot.analytics
  )
  return <>
    <PreferenceBody analytics={analytics} setAnalytics={setAnalytics} />
    {saveFailed ? <p role="alert" className="text-sm text-destructive">{t("cookie.saveFailed")}</p> : null}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="outline" disabled={saving} onClick={() => setSettingsOpen(false)}>{t("common.cancel")}</Button>
      <Button disabled={saving} onClick={() => void decide(analytics ? "accepted" : "rejected")}>
        {saving ? t("common.processing") : t("common.save")}
      </Button>
    </div>
  </>
}

export function ConsentPreferences() {
  const { settingsOpen, setSettingsOpen } = usePrivacy()
  const { t } = useI18n()
  const mobile = useIsMobile()
  if (mobile) {
    return <Drawer open={settingsOpen} onOpenChange={setSettingsOpen} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("cookie.title")}</DrawerTitle>
          <DrawerDescription>{t("cookie.description")}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4"><SettingsContent /></div>
        <DrawerFooter />
      </DrawerContent>
    </Drawer>
  }
  return <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t("cookie.title")}</DialogTitle>
        <DialogDescription>{t("cookie.description")}</DialogDescription>
      </DialogHeader>
      <SettingsContent />
      <DialogFooter />
    </DialogContent>
  </Dialog>
}

export function ConsentBanner() {
  const { consent, saving, saveFailed, decide, setSettingsOpen } = usePrivacy()
  const { t } = useI18n()
  if (consent.state === "valid") return null
  return <aside className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-2xl border bg-background p-4 shadow-xl" aria-labelledby="consent-title">
    <h2 id="consent-title" className="font-medium">{t("cookie.title")}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("cookie.description")}</p>
    {saveFailed ? <p role="alert" className="mt-2 text-sm text-destructive">{t("cookie.saveFailed")}</p> : null}
    <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="outline" disabled={saving} onClick={() => void decide("rejected")}>{t("cookie.reject")}</Button>
      <Button variant="outline" disabled={saving} onClick={() => setSettingsOpen(true)}>{t("cookie.customize")}</Button>
      <Button disabled={saving} onClick={() => void decide("accepted")}>{t("cookie.accept")}</Button>
    </div>
  </aside>
}

export function PrivacySettingsButton({ className }: { className?: string }) {
  const { setSettingsOpen } = usePrivacy()
  const { t } = useI18n()
  return <button type="button" className={className} onClick={() => setSettingsOpen(true)}>{t("cookie.settings")}</button>
}

