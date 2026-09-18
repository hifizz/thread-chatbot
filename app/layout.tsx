import { getRequestLocaleContext } from "@/lib/i18n/server"
import { I18nProvider } from "@/lib/i18n/client"
import { getRequestConsentState } from "@/lib/privacy/server"
import { PrivacyProvider } from "@/lib/privacy/client"
import { ConsentBanner, ConsentPreferences } from "@/components/privacy/consent-controls"
import { fontVariables } from "./fonts"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const [{ locale, source, identity }, initialConsent] = await Promise.all([
    getRequestLocaleContext(),
    getRequestConsentState(),
  ])
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontVariables,
        "font-sans"
      )}
    >
      <body>
        <I18nProvider key={identity} locale={locale} source={source}>
        <PrivacyProvider key={identity} initialConsent={initialConsent}>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <ConsentBanner />
          <ConsentPreferences />
          <Toaster />
        </ThemeProvider>
        </PrivacyProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
