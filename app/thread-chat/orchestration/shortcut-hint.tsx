import { Kbd, KbdGroup } from "@/components/ui/kbd"

interface ShortcutHintProps {
  keys: readonly string[]
  label: string
  className?: string
}

/** 用 shadcn Kbd 组合渲染 thread-chat 的快捷键提示。 */
export function ShortcutHint({ keys, label, className }: ShortcutHintProps) {
  return (
    <KbdGroup className={className} aria-label={label}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}
