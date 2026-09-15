"use client"

import { Monitor } from "lucide-react"
import { useTheme } from "next-themes"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { THEME_OPTIONS } from "@/constants/theme"

export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>外观</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
        {THEME_OPTIONS.map(({ value, label }) => (
          <DropdownMenuRadioItem key={value} value={value}>
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  )
}

export function ThemeMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="tbtn"
        aria-label="外观主题"
        title="外观主题（D 切换深浅色，Shift+D 跟随系统）"
      >
        <Monitor size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ThemeMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
