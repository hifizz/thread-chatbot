"use client"

import type { FC } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { useShikiHighlighter } from "react-shiki"
import { CheckIcon, CopyIcon, ShareIcon, XIcon } from "lucide-react"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import {
  useMarkdownArtifactStore,
  type MarkdownArtifactView,
} from "@/lib/artifact/markdown-artifact-store"
import { cn } from "@/lib/utils"

const VIEW_OPTIONS: { value: MarkdownArtifactView; label: string }[] = [
  { value: "preview", label: "Preview" },
  { value: "code", label: "Code" },
]

const ViewToggle: FC = () => {
  const view = useMarkdownArtifactStore((s) => s.view)
  const setView = useMarkdownArtifactStore((s) => s.setView)
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
      tooltip="Copy Markdown"
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
    // No Web Share support (typical on desktop): fall back to copying the Markdown.
    copyToClipboard(`# ${title}\n\n${content}`)
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

// Document-scale typography for the standalone preview. This intentionally does
// not reuse markdown-text.tsx's component map: that one depends on assistant-ui
// message-part context (useIsMarkdownCodeBlock, CodeHeader), which doesn't exist
// under a plain react-markdown render.
// react-markdown passes its hast `node` to every component; strip it so the
// prop spread doesn't leak node="[object Object]" onto the DOM elements.
const stripNode = <P extends { node?: unknown }>(props: P): Omit<P, "node"> => {
  const { node, ...rest } = props
  void node
  return rest
}

const previewComponents: Components = {
  h1: (props) => (
    <h1
      className="mt-8 mb-3 scroll-m-20 text-2xl font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h2: (props) => (
    <h2
      className="mt-7 mb-3 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h3: (props) => (
    <h3
      className="mt-6 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h4: (props) => (
    <h4
      className="mt-5 mb-2 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h5: (props) => (
    <h5
      className="mt-4 mb-1.5 text-sm font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h6: (props) => (
    <h6
      className="mt-4 mb-1.5 text-sm font-medium first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  p: (props) => (
    <p
      className="my-3 leading-relaxed first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  a: (props) => (
    <a
      className="text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noreferrer"
      {...stripNode(props)}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="my-3 border-s-2 border-muted-foreground/30 ps-4 text-muted-foreground"
      {...stripNode(props)}
    />
  ),
  ul: (props) => (
    <ul
      className="my-3 ms-5 list-disc marker:text-muted-foreground [&>li]:mt-1"
      {...stripNode(props)}
    />
  ),
  ol: (props) => (
    <ol
      className="my-3 ms-5 list-decimal marker:text-muted-foreground [&>li]:mt-1"
      {...stripNode(props)}
    />
  ),
  li: (props) => <li className="leading-relaxed" {...stripNode(props)} />,
  hr: (props) => (
    <hr className="my-4 border-muted-foreground/20" {...stripNode(props)} />
  ),
  table: (props) => (
    <table
      className="my-3 w-full border-separate border-spacing-0 overflow-y-auto"
      {...stripNode(props)}
    />
  ),
  th: (props) => (
    <th
      className="bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg"
      {...stripNode(props)}
    />
  ),
  td: (props) => (
    <td
      className="border-s border-b border-muted-foreground/20 px-3 py-1.5 text-start last:border-e"
      {...stripNode(props)}
    />
  ),
  tr: (props) => (
    <tr
      className="m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg"
      {...stripNode(props)}
    />
  ),
  strong: (props) => <strong className="font-semibold" {...stripNode(props)} />,
  pre: (props) => (
    <pre
      className="my-3 overflow-x-auto rounded-xl border border-border/50 bg-muted/30 p-3.5 text-[13px] leading-relaxed"
      {...stripNode(props)}
    />
  ),
}

const MarkdownPreview: FC<{ content: string }> = ({ content }) => {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6 text-[15px] [&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.85em]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={previewComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

const RawMarkdown: FC<{ content: string }> = ({ content }) => {
  const highlighted = useShikiHighlighter(
    content,
    "markdown",
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

export const MarkdownArtifactPanel: FC = () => {
  const artifact = useMarkdownArtifactStore((s) => s.artifact)
  const view = useMarkdownArtifactStore((s) => s.view)
  const closePanel = useMarkdownArtifactStore((s) => s.closePanel)
  if (!artifact) return null

  return (
    <div
      data-slot="markdown-artifact-panel"
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
          <MarkdownPreview content={artifact.content} />
        ) : (
          <RawMarkdown content={artifact.content} />
        )}
      </div>
    </div>
  )
}
