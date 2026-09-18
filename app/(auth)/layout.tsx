import { LanguageSwitcher } from "@/components/i18n/language-switcher"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6">
      <div className="fixed right-4 top-4"><LanguageSwitcher /></div>
      {children}
    </div>
  )
}
