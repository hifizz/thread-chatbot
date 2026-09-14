"use client"

import { ChevronDown } from "lucide-react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import type { DocumentRevisionDTO } from "@/lib/thread-chat/contracts/document"

export function DocumentVersionHistory({ revisions, revisionId, currentRevisionId, onSelect }: {
  revisions: DocumentRevisionDTO[]; revisionId: string; currentRevisionId: string
  onSelect(revision: DocumentRevisionDTO): void
}) {
  const selected = revisions.find((revision) => revision.id === revisionId)
  return <DropdownMenu>
    <DropdownMenuTrigger className="project-secondary" aria-label="选择文档版本">
      V{selected?.revisionNumber ?? "…"}{revisionId === currentRevisionId ? " · 最新" : " · 历史"} <ChevronDown size={12} />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="w-72 max-w-[90vw]">
      {revisions.map((revision) => <DropdownMenuItem key={revision.id} onClick={() => onSelect(revision)}>
        <div>
          <strong>V{revision.revisionNumber}{revision.id === currentRevisionId ? " · 最新" : ""}</strong>
          <div className="text-xs">{revision.changeSummary}</div>
          <time className="text-xs" dateTime={revision.createdAt}>{new Date(revision.createdAt).toLocaleString("zh-CN")}</time>
        </div>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
