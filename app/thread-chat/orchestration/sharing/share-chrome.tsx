/**
 * orchestration/sharing/share-chrome —— 只读分享的共享行件（Tailwind 实现）。
 * ShareBadge：顶栏/文档页的状态徽标；ReadOnlyStrip：替换 Composer 的静态只读条，
 * 仍沿用 .composer 外壳的条形容量，仅文字与居中用 Tailwind。
 */

import { SHARE_UI_COPY } from "@/constants/sharing"

export function ShareBadge() {
  return (
    <span className="inline-flex items-center rounded-lg border border-[var(--tc-border-strong)] bg-[var(--tc-surface-plain)] px-2 py-1 text-[11px] leading-none tracking-[0.5px] text-[var(--tc-depth-1)]">
      {SHARE_UI_COPY.readOnlyBadge}
    </span>
  )
}

export function ReadOnlyStrip() {
  return (
    <div className="composer flex items-center justify-center bg-[var(--tc-surface-plain)] text-xs text-[var(--tc-content-secondary)]">
      {SHARE_UI_COPY.readOnlyBadge} · 内容在分享时冻结
    </div>
  )
}
