"use client"

import { useEffect, useRef, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { BookOpen } from "lucide-react"
import ThinkingState, {
  TraceFavicon,
} from "@/components/primitives/ThinkingState"
import type { ResearchRoute } from "@/lib/chat/research-contract"
import {
  settledResearchActivities,
  type WebResearchActivity,
} from "@/lib/chat/web-research-activity"
import type { MarkdownGenerationProgress } from "../../core/types"
import { useI18n } from "@/lib/i18n/client"


/* 把消息上已投影的 reasoning / 联网活动 / 工具事件映射为 beautiful-ui
 * ThinkingState 轨迹。官方 token 由 `.bui` 作用域提供（app/beautifui/foundation.css），
 * 正文流中的间距由 `.tc .thinking-trace` 提供，组件自身不感知宿主设计系统。 */

interface TraceRow {
  primary: string
  secondary?: string
  mono?: boolean
  href?: string
  icon?: "book-open" | "search"
  /** 行内 spinner（进行中的读取/搜索）。 */
  running?: boolean
  /** 失败行：图标与副文本转警示色。 */
  failed?: boolean
  /** 非强调行（如搜索词），主文本降为次级墨色。 */
  subtle?: boolean
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

/* reasoning 文本按行内 markdown 渲染：模型常输出 **强调**、`code` 等标记，
 * 纯文本渲染会把记号原样露出。只放行行内元素，块级结构一律 unwrap。 */
const INLINE_MARKDOWN_ELEMENTS = ["strong", "em", "del", "code", "a", "br"]

function InlineMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      allowedElements={INLINE_MARKDOWN_ELEMENTS}
      unwrapDisallowed
      components={{
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="md-inline-code">{children}</code>
        ),
      }}
    >
      {text}
    </Markdown>
  )
}

/** 思维链：reasoning part 的分段文本 → Reasoning 变体；耗时在客户端首次捕获。 */
export function ReasoningTrace({ part }: { part: { text: string; state?: string } }) {
  const { t } = useI18n()

  const working = part.state === "streaming"
  const startRef = useRef<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null)

  useEffect(() => {
    if (part.state === "streaming") {
      if (startRef.current === null) startRef.current = Date.now()
      return
    }
    if (startRef.current !== null && elapsedSeconds === null) {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - startRef.current) / 1000)))
    }
  }, [part.state, elapsedSeconds])

  const rows: TraceRow[] = part.text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((primary) => ({ primary }))

  if (!working && rows.length === 1) {
    return (
      <div
        className="thinking-trace-compact"
        data-ui-message-part="reasoning"
      >
        <InlineMarkdown text={rows[0].primary} />
      </div>
    )
  }

  return (
    <div className="thinking-trace bui" data-ui-message-part="reasoning">
      <ThinkingState
        variant="Reasoning"
        working={working}
        active={t("ui.thinking")}
        done={
          elapsedSeconds === null ? t("ui.thinkingComplete") : t("chat.thinkingSeconds", { seconds: elapsedSeconds })
        }
        rows={rows}
        renderPrimary={(row) => <InlineMarkdown text={row.primary} />}
      />
    </div>
  )
}

/** 联网轨迹：连续的 search/read 活动合并为一个 Search 变体时间线——
 * 搜索词行 + 来源行（favicon）+ 读取行（BookOpen）。已读来源不重复成行，
 * 只在来源行副文本标注；同 URL 的续读游标合并为一行。 */
export function SearchTrace({
  activities,
  complete,
  settled = false,
}: {
  activities: WebResearchActivity[]
  route?: ResearchRoute
  complete: boolean
  settled?: boolean
}) {
  const { t } = useI18n()

  if (activities.length === 0) return null

  const currentActivities = settledResearchActivities(activities, settled)

  const rows: TraceRow[] = []
  const byUrl = new Map<string, TraceRow>()
  const readUrls = new Set<string>()
  let sourceCount = 0
  let failedCount = 0
  for (const activity of currentActivities) {
    if (activity.status === "failed") failedCount++
    if (activity.kind === "search") {
      rows.push({
        primary: activity.query ?? t("ui.searchTheWeb"),
        icon: "search",
        subtle: true,
        running: activity.status === "running",
        failed: activity.status === "failed",
        secondary: activity.status === "failed" ? t("ui.searchFailed") : undefined,
      })
      for (const source of activity.sources) {
        if (byUrl.has(source.url)) continue
        const row: TraceRow = {
          primary: source.title,
          secondary: hostOf(source.url),
          href: source.url,
        }
        byUrl.set(source.url, row)
        rows.push(row)
        sourceCount++
      }
      continue
    }
    if (!activity.url) continue
    const url = activity.url
    if (activity.status !== "failed") readUrls.add(url)
    const host = hostOf(url)
    const existing = byUrl.get(url)
    if (existing) {
      if (existing.icon === "book-open") {
        existing.running = activity.status === "running"
        existing.failed = activity.status === "failed"
        if (activity.title) {
          existing.primary = activity.title
          existing.secondary = host
        }
      } else {
        existing.secondary =
          activity.status === "running"
            ? t("chat.readingHost", { host })
            : activity.status === "failed"
              ? t("chat.failedHost", { host })
              : activity.truncated
                ? t("chat.partialHost", { host })
                : t("chat.readHost", { host })
      }
      continue
    }
    const row: TraceRow = {
      primary: activity.title ?? host,
      secondary:
        activity.status === "failed"
          ? t("chat.failedHost", { host })
          : activity.truncated && activity.status === "complete"
            ? t("chat.partReadHost", { host })
            : host,
      href: url,
      icon: "book-open",
      running: activity.status === "running",
      failed: activity.status === "failed",
    }
    byUrl.set(url, row)
    rows.push(row)
  }

  const working =
    !complete &&
    currentActivities.some((activity) => activity.status === "running")
  const readMode = currentActivities.every(
    (activity) => activity.kind === "read"
  )
  const runningActivity = [...currentActivities]
    .reverse()
    .find((activity) => activity.status === "running")
  const active =
    runningActivity?.kind === "read" && runningActivity.url
      ? t("chat.readingPage", { host: hostOf(runningActivity.url) })
      : readMode
        ? t("ui.readingWebpage")
        : t("ui.searchingTheWeb")

  const readCount = readUrls.size
  const done = (() => {
    if (sourceCount === 0 && readCount === 0) {
      return failedCount
        ? t("ui.webVerificationFailed")
        : readMode
          ? t("ui.webpageRead")
          : t("ui.webSearched")
    }
    const segments: string[] = []
    if (sourceCount) segments.push(t("chat.sourcesCount", { count: sourceCount }))
    if (readCount) segments.push(t("chat.readCount", { count: readCount }))
    if (failedCount) segments.push(t("chat.failureCount", { count: failedCount }))
    return segments.join(" · ")
  })()

  const sourceHrefs = rows
    .filter((row) => row.href && !row.icon && !row.failed)
    .slice(0, 3)
    .map((row) => row.href!)
  const icon = working
    ? undefined
    : sourceHrefs.length > 0
      ? (
        <span className="flex items-center -space-x-1">
          {sourceHrefs.map((href) => (
            <TraceFavicon
              key={href}
              href={href}
              className="size-3.5 shrink-0 rounded-full shadow-[0_0_0_1px_var(--page)]"
            />
          ))}
        </span>
      )
      : readMode
        ? <BookOpen aria-hidden className="size-3.5" />
        : undefined

  return (
    <div className="thinking-trace bui">
      <ThinkingState
        variant="Search"
        working={working}
        active={active}
        done={done}
        icon={icon}
        rows={rows}
      />
    </div>
  )
}

/** 工具轨迹：createMarkdownArtifact 等 → Coding 变体；联网工具由 SearchTrace 表达。 */
export function ToolTrace({
  toolState,
  progress,
}: {
  toolState?: string
  progress?: MarkdownGenerationProgress
}) {
  const { t } = useI18n()

  const finished = toolState === "output-available" || toolState === "output-error"
  const secondary = progress?.partialTitle
    ? progress.characterCount > 0
      ? t("chat.titleCharacters", { title: progress.partialTitle, count: progress.characterCount })
      : progress.partialTitle
    : progress && progress.characterCount > 0
      ? t("chat.characters", { count: progress.characterCount })
      : undefined

  return (
    <div className="thinking-trace bui">
      <ThinkingState
        variant="Coding"
        working={!finished}
        active={t("ui.creatingDocument")}
        done={toolState === "output-error" ? t("ui.generationFailed") : t("ui.documentCreated")}
        rows={[{ primary: t("ui.createDocument"), secondary, mono: true }]}
      />
    </div>
  )
}
