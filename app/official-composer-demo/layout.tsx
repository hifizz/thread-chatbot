import { OfficialComposerTheme } from "@/components/assistant-ui/official-composer-demo/theme"

export default function OfficialDemoLayout({ children }: { children: React.ReactNode }) {
  return <OfficialComposerTheme>{children}</OfficialComposerTheme>
}
