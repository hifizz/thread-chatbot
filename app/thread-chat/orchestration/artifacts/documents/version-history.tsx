"use client"

import { useRef } from "react"
import { ChevronDown } from "lucide-react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { DOCUMENT_UI_KEYS } from "@/constants/project-documents"
import type { DocumentRevisionSummaryDTO } from "@/lib/thread-chat/contracts/document"
import { VersionPillSkeleton } from "../skeleton"
import { useI18n } from "@/lib/i18n/client"


export function DocumentVersionHistory({ revisions, revisionId, currentRevisionId, disabled, onSelect }: {
  disabled: boolean
  revisions: DocumentRevisionSummaryDTO[]; revisionId: string; currentRevisionId: string
  onSelect(revision: DocumentRevisionSummaryDTO): void
}) {
  const { t } = useI18n()

  const container = useRef<HTMLDivElement>(null)
  const selected = revisions.find((revision) => revision.id === revisionId)
  if (!selected) return <VersionPillSkeleton />
  const disabledReason = disabled ? t(DOCUMENT_UI_KEYS.navigationBlocked) : undefined
  return <div ref={container} title={disabledReason}>
    {/* 提问开合不能推移正文，否则滚动锚定会触发全局选区关闭监听。 */}
    <span className="sr-only" role="status">{disabledReason}</span>
    <DropdownMenu>
    <DropdownMenuTrigger disabled={disabled} className="artifact-version" aria-label={t("ui.chooseADocumentVersion")} title={disabledReason ?? t("ui.chooseADocumentVersion")}>
      V{selected?.revisionNumber ?? "…"}{revisionId === currentRevisionId ? " · 最新" : " · 历史"} <ChevronDown size={10} />
    </DropdownMenuTrigger>
    <DropdownMenuContent container={container} className="w-72 max-w-[90vw]">
      {revisions.map((revision) => <DropdownMenuItem key={revision.id} onClick={() => onSelect(revision)}>
        <div>
          <strong>V{revision.revisionNumber}{revision.id === currentRevisionId ? " · 最新" : ""}</strong>
          <div className="text-xs">{revision.changeSummary}</div>
          <time className="text-xs" dateTime={revision.createdAt}>{new Date(revision.createdAt).toLocaleString("zh-CN")}</time>
        </div>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu></div>
}
