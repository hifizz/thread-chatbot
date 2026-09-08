"use client"

import { RotateCcwIcon, XIcon } from "lucide-react"
import { COMPOSER_ATTACHMENT_COPY } from "@/constants/attachment"
import { ComposerAttachmentChip, ComposerAttachments } from "@/components/assistant-ui/elements/composer/attachments"
import { ghostButton } from "@/components/assistant-ui/elements/surfaces"
import { formatComposerAttachmentSize, type ComposerAttachmentDraft } from "@/lib/thread-chat/composer-attachments"

export function ComposerAttachmentTray({ items, disabled, onRemove, onRetry }: {
  items: ComposerAttachmentDraft[]; disabled: boolean; onRemove(id: string): void; onRetry(id: string): void
}) {
  if (!items.length) return null
  return <ComposerAttachments inert={disabled} aria-label={COMPOSER_ATTACHMENT_COPY.tray}>
    {items.map((item) => <div key={item.id} className="flex items-center gap-1" title={item.status === "error" ? item.error : item.file.name}>
      <ComposerAttachmentChip attachment={{
        name: item.file.name,
        kind: item.file.type.startsWith("image/") && item.file.type !== "image/svg+xml" ? "image" : "text",
        state: item.status === "ready" ? "done" : item.status,
        meta: item.status === "error" ? COMPOSER_ATTACHMENT_COPY.failed : item.status === "uploading" ? `${COMPOSER_ATTACHMENT_COPY.uploading} ${Math.round(item.progress * 100)}%` : formatComposerAttachmentSize(item.file.size),
        progress: item.status === "uploading" ? item.progress * 100 : undefined,
      }} onRemove={() => onRemove(item.id)} />
      {item.status === "error" && <button type="button" className={`${ghostButton} size-5`} aria-label={`${COMPOSER_ATTACHMENT_COPY.retry} ${item.file.name}`} onClick={() => onRetry(item.id)}><RotateCcwIcon className="size-3" /></button>}
      {item.status !== "ready" && <button type="button" className={`${ghostButton} size-5`} aria-label={`${COMPOSER_ATTACHMENT_COPY.remove} ${item.file.name}`} onClick={() => onRemove(item.id)}><XIcon className="size-3" /></button>}
    </div>)}
  </ComposerAttachments>
}
