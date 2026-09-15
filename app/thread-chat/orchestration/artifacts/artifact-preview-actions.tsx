"use client"

import { useRef, useState } from "react"
import { Check, Copy, LocateFixed, MoreHorizontal } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { useCopyMarkdown } from "../../chat/actions/use-copy-markdown"
import { DocumentExportActions } from "./documents/export-actions"

/** 阅读页只保留一个操作入口，来源与文件操作按需展示。 */
export function ArtifactPreviewActions({ artifact, onLocate }: { artifact: ArtifactDTO; onLocate(): void }) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopyMarkdown(setError)
  return <div ref={container} className="project-preview-actions">
    <DropdownMenu>
      <DropdownMenuTrigger className="project-preview-more" aria-label="文档操作与来源" title="文档操作与来源"><MoreHorizontal size={18} /></DropdownMenuTrigger>
      <DropdownMenuContent container={container} align="end" className="w-64 max-w-[90vw]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>来源：{artifact.sourceThreadTitle ?? "未命名对话"}<br />{new Date(artifact.createdAt).toLocaleString("zh-CN")}</DropdownMenuLabel>
          <DropdownMenuItem onClick={onLocate}><LocateFixed size={14} />定位来源</DropdownMenuItem>
        </DropdownMenuGroup>
        {artifact.kind === "markdown" && <>
          <DropdownMenuSeparator />
          {error && <p role="alert">{error}</p>}
          <DropdownMenuItem closeOnClick={false} onClick={() => void copy(artifact.content)}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制 Markdown"}</DropdownMenuItem>
          {artifact.document && <DocumentExportActions artifact={artifact} />}
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
}
