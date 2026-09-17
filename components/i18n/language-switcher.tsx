"use client"

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/constants/i18n"
import { isLocale } from "@/lib/i18n/resolve-locale"
import { useI18n } from "@/lib/i18n/client"

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, saving, syncFailed, setLocale, t } = useI18n()
  return <div className={className}>
    <NativeSelect value={locale} disabled={saving} size="sm" aria-label={t("locale.label")} onChange={(event) => {
      if (isLocale(event.target.value)) void setLocale(event.target.value)
    }}>
      {SUPPORTED_LOCALES.map((value) => <NativeSelectOption key={value} value={value}>{LOCALE_LABELS[value]}</NativeSelectOption>)}
    </NativeSelect>
    {syncFailed && <p role="status" className="mt-1 max-w-64 text-xs text-muted-foreground">
      {t("locale.deviceOnly")} <button type="button" className="underline" onClick={() => void setLocale(locale)}>{t("common.retry")}</button>
    </p>}
  </div>
}
