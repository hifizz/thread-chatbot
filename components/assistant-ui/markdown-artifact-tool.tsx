"use client"

import { useEffect, useRef } from "react"
import {
  useAssistantTool,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react"
import { FileTextIcon, LoaderCircleIcon } from "lucide-react"
import { artifactRenderers } from "@/components/artifact/renderers"
import { MARKDOWN_DOCUMENT_TOOL_NAME } from "@/constants/tools"
import { useArtifactStore } from "@/lib/artifact/artifact-store"

type MarkdownDocumentArgs = { title?: string; content?: string }
type MarkdownDocumentResult = { title: string; content: string }

const ARTIFACT_TYPE = "markdown" as const

const MarkdownDocumentToolUI: ToolCallMessagePartComponent<
  MarkdownDocumentArgs,
  MarkdownDocumentResult
> = ({ toolCallId, args, result, status }) => {
  const title = result?.title ?? args.title ?? "Untitled document"
  const content = result?.content ?? args.content ?? ""
  const isRunning = status.type === "running"
  const showArtifact = useArtifactStore((s) => s.showArtifact)
  const syncArtifact = useArtifactStore((s) => s.syncArtifact)

  // Keep the panel live while this document streams (or after an edit/regenerate),
  // but only if it's the document currently on display.
  useEffect(() => {
    syncArtifact({ toolCallId, type: ARTIFACT_TYPE, title, content })
  }, [syncArtifact, toolCallId, title, content])

  // Auto-open the preview panel when generation finishes in this session.
  // History reloads mount with a result and never pass through "running",
  // so they don't pop the panel open on page load.
  const sawRunning = useRef(false)
  useEffect(() => {
    if (isRunning) sawRunning.current = true
  }, [isRunning])
  useEffect(() => {
    if (!result || !sawRunning.current) return
    sawRunning.current = false
    showArtifact({
      toolCallId,
      type: ARTIFACT_TYPE,
      title: result.title,
      content: result.content,
    })
  }, [showArtifact, toolCallId, result])

  return (
    <button
      type="button"
      data-slot="markdown-artifact-tool"
      onClick={() =>
        showArtifact({ toolCallId, type: ARTIFACT_TYPE, title, content })
      }
      className="my-3 flex w-full max-w-sm items-center gap-3 rounded-xl border border-border/60 px-4 py-3 text-start transition-colors hover:bg-muted/50"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        {isRunning ? (
          <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <FileTextIcon className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">
          {isRunning
            ? "Generating document…"
            : `${artifactRenderers[ARTIFACT_TYPE].label} · Click to open`}
        </div>
      </div>
    </button>
  )
}

export function MarkdownArtifactTool() {
  useAssistantTool({
    toolName: MARKDOWN_DOCUMENT_TOOL_NAME,
    type: "backend",
    display: "standalone",
    render: MarkdownDocumentToolUI,
  })
  return null
}
