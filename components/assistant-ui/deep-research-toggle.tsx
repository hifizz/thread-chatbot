"use client"

import { type FC } from "react"
import { TelescopeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useResearchMode } from "@/lib/chat/research-mode"

// composer 左下角的「深度研究」开关。开启后本轮对话会联网检索、多步推进并给出带引用的报告。
export const DeepResearchToggle: FC = () => {
  const enabled = useResearchMode((s) => s.enabled)
  const toggle = useResearchMode((s) => s.toggle)

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-pressed={enabled}
      className={cn(
        "h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal",
        enabled
          ? "bg-primary/10 text-primary hover:bg-primary/15"
          : "text-muted-foreground hover:bg-muted-foreground/10"
      )}
    >
      <TelescopeIcon className="size-4" />
      深度研究
    </Button>
  )
}
