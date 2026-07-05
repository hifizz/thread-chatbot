"use client"

import type { FC } from "react"
import { useShikiHighlighter } from "react-shiki"
import { CheckIcon, CopyIcon, ShareIcon, XIcon } from "lucide-react"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"
import { artifactRenderers } from "@/components/artifact/renderers"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import {
  useArtifactStore,
  type ArtifactView,
} from "@/lib/artifact/artifact-store"
import { cn } from "@/lib/utils"

const VIEW_OPTIONS: { value: ArtifactView; label: string }[] = [
  { value: "preview", label: "Preview" },
  { value: "code", label: "Code" },
]

const ViewToggle: FC = () => {
  const view = useArtifactStore((s) => s.view)
  const setView = useArtifactStore((s) => s.setView)
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {VIEW_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setView(option.value)}
          aria-pressed={view === option.value}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            view === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const CopyButton: FC<{ content: string }> = ({ content }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard()
  return (
    <TooltipIconButton
      tooltip="Copy source"
      side="bottom"
      onClick={() => copyToClipboard(content)}
    >
      {isCopied ? (
        <CheckIcon className="animate-in duration-200 ease-out zoom-in-50 fade-in" />
      ) : (
        <CopyIcon className="animate-in duration-150 zoom-in-75 fade-in" />
      )}
    </TooltipIconButton>
  )
}

const ShareButton: FC<{ title: string; content: string }> = ({
  title,
  content,
}) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard()
  const onShare = async () => {
    const shareData = { title, text: content }
    if (typeof navigator !== "undefined" && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData)
      } catch {
        // user dismissed the share sheet - nothing to do
      }
      return
    }
    // No Web Share support (typical on desktop): fall back to copying the source.
    copyToClipboard(content)
  }
  return (
    <TooltipIconButton tooltip="Share" side="bottom" onClick={onShare}>
      {isCopied ? (
        <CheckIcon className="animate-in duration-200 ease-out zoom-in-50 fade-in" />
      ) : (
        <ShareIcon className="animate-in duration-150 zoom-in-75 fade-in" />
      )}
    </TooltipIconButton>
  )
}

const RawSource: FC<{ content: string; language: string }> = ({
  content,
  language,
}) => {
  const highlighted = useShikiHighlighter(
    content,
    language,
    { dark: "github-dark-default", light: "github-light-default" },
    { defaultColor: "light-dark()", delay: 150 }
  )
  const fallback = (
    <pre>
      <code>{content}</code>
    </pre>
  )
  return (
    <div className="[&_pre]:bg-transparent! [&_pre]:p-6 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_pre]:wrap-break-word [&_pre]:whitespace-pre-wrap">
      {highlighted ?? fallback}
    </div>
  )
}

/**
 * Framework-level preview panel, rendered as a sibling of the whole chat shell
 * (not inside it). Everything conversation-related stays in the left panel;
 * this one only knows how to display the current artifact, dispatching the
 * Preview view to the renderer registered for the artifact's type.
 */
export const ArtifactPanel: FC = () => {
  const artifact = useArtifactStore((s) => s.artifact)
  const view = useArtifactStore((s) => s.view)
  const closePanel = useArtifactStore((s) => s.closePanel)
  if (!artifact) return null

  const renderer = artifactRenderers[artifact.type]

  return (
    <div
      data-slot="artifact-panel"
      className="flex h-full flex-col bg-background"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <ViewToggle />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {artifact.title}
        </h2>
        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <CopyButton content={artifact.content} />
          <ShareButton title={artifact.title} content={artifact.content} />
          <TooltipIconButton tooltip="Close" side="bottom" onClick={closePanel}>
            <XIcon />
          </TooltipIconButton>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        {view === "preview" ? (
          <renderer.Preview content={artifact.content} />
        ) : (
          <RawSource
            content={artifact.content}
            language={renderer.codeLanguage}
          />
        )}
      </div>
    </div>
  )
}
