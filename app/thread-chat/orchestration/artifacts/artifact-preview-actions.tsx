"use client"

import { useRef, useState } from "react"
import { Check, Copy, LocateFixed, MoreHorizontal } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { useCopyMarkdown } from "../../chat/actions/use-copy-markdown"
import { DocumentExportActions } from "./documents/export-actions"

/** 阅读屏头部的操作菜单；来源与时间已展示在标题下的 meta 行，菜单只留动作。 */
export function ArtifactPreviewActions({
  artifact,
  onLocate,
}: {
  artifact: ArtifactDTO
  onLocate(): void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopyMarkdown(setError)
  return (
    <div ref={container} className="artifact-actions">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="artifact-more"
          aria-label="文档操作"
          title="文档操作"
        >
          <MoreHorizontal size={18} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          container={container}
          align="end"
          className="w-64 max-w-[90vw]"
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onLocate}>
              <LocateFixed size={14} />
              定位来源
            </DropdownMenuItem>
            {artifact.kind === "markdown" && (
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => void copy(artifact.content)}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "已复制" : "复制 Markdown"}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {artifact.kind === "markdown" && artifact.document && (
            <>
              <DropdownMenuSeparator />
              {error && <p role="alert">{error}</p>}
              <DocumentExportActions artifact={artifact} />
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
