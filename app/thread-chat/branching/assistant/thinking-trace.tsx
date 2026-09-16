"use client"

import { useEffect, useRef, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { BookOpen, FileText } from "lucide-react"
import ThinkingState, {
  TraceFavicon,
} from "@/components/primitives/ThinkingState"
import { DOCUMENT_RESULT_COPY } from "@/constants/project-documents"
import type { ResearchRoute } from "@/lib/chat/research-contract"
import {
  settledResearchActivities,
  type WebResearchActivity,
} from "@/lib/chat/web-research-activity"
import type { MarkdownGenerationProgress } from "../../core/types"
import type { DocumentToolPart } from "./assistant-part-render-plan"

/* 把消息上已投影的 reasoning / 联网活动 / 工具事件映射为 beautiful-ui
 * ThinkingState 轨迹。官方 token 由 `.bui` 作用域提供（app/beautifui/foundation.css），
 * 正文流中的间距由 `.tc .thinking-trace` 提供，组件自身不感知宿主设计系统。 */

interface TraceRow {
  primary: string
  secondary?: string
  mono?: boolean
  href?: string
  icon?: "book-open" | "search" | "file-pen"
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
        active="思考中"
        done={
          elapsedSeconds === null ? "思考完成" : `思考了 ${elapsedSeconds} 秒`
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
        primary: activity.query ?? "搜索网络",
        icon: "search",
        subtle: true,
        running: activity.status === "running",
        failed: activity.status === "failed",
        secondary: activity.status === "failed" ? "搜索失败" : undefined,
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
            ? `${host} · 读取中`
            : activity.status === "failed"
              ? `${host} · 读取失败`
              : activity.truncated
                ? `${host} · 已读（部分）`
                : `${host} · 已读`
      }
      continue
    }
    const row: TraceRow = {
      primary: activity.title ?? host,
      secondary:
        activity.status === "failed"
          ? `${host} · 读取失败`
          : activity.truncated && activity.status === "complete"
            ? `${host} · 部分读取`
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
      ? `正在读取 ${hostOf(runningActivity.url)}`
      : readMode
        ? "正在读取网页"
        : "正在搜索网络"

  const readCount = readUrls.size
  const done = (() => {
    if (sourceCount === 0 && readCount === 0) {
      return failedCount
        ? "联网核实失败"
        : readMode
          ? "已读取网页"
          : "已搜索网络"
    }
    const segments: string[] = []
    if (sourceCount) segments.push(`已搜索网络 · ${sourceCount} 个来源`)
    if (readCount) segments.push(`已读取 ${readCount} 个网页`)
    if (failedCount) segments.push(`${failedCount} 项失败`)
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

/** 项目文档轨迹：连续的查找/读取/提交调用合并为一个时序块，
 * 每行给出步骤名与结果；update 的提交结果卡片由 DocumentUpdateTool 另行渲染。 */
export function DocumentTrace({
  parts,
  settled,
}: {
  parts: DocumentToolPart[]
  settled: boolean
}) {
  if (parts.length === 0) return null

  const rows: TraceRow[] = parts.map((part) => {
    const finished =
      part.state === "output-available" || part.state === "output-error"
    const running = !settled && !finished
    const failed =
      part.state === "output-error" || (settled && !finished)
    if (part.type === "tool-findProjectDocuments") {
      const query = part.input?.query?.trim()
      return {
        primary: query ? `查找文档“${query}”` : "查找项目文档",
        icon: "search" as const,
        running,
        failed,
        secondary: failed
          ? "查找失败"
          : part.state === "output-available"
            ? `${part.output.length} 份候选`
            : undefined,
      }
    }
    if (part.type === "tool-readProjectDocument") {
      const done = part.state === "output-available"
      return {
        primary: done
          ? `读取「${part.output.revision.title}」`
          : "读取项目文档",
        icon: "book-open" as const,
        running,
        failed,
        secondary: failed
          ? "读取失败"
          : done
            ? `V${part.output.revision.revisionNumber}`
            : undefined,
      }
    }
    const out = part.state === "output-available" ? part.output : undefined
    return {
      primary: "提交文档修改",
      icon: "file-pen" as const,
      running,
      failed,
      secondary: failed
        ? "保存失败"
        : out?.status === "committed"
          ? "已保存"
          : out?.status === "unchanged"
            ? "无需修改"
            : out?.status === "conflict"
              ? "版本冲突"
              : out?.status === "rejected"
                ? (DOCUMENT_RESULT_COPY[out.code] ?? "未保存")
                : undefined,
    }
  })

  const runningPart = parts.find(
    (part) =>
      part.state !== "output-available" && part.state !== "output-error"
  )
  const working = Boolean(!settled && runningPart)
  const active =
    runningPart?.type === "tool-findProjectDocuments"
      ? "正在查找项目文档"
      : runningPart?.type === "tool-readProjectDocument"
        ? "正在读取项目文档"
        : runningPart?.type === "tool-updateProjectDocument"
          ? "正在提交文档修改"
          : "正在处理项目文档"

  const done = (() => {
    const segments: string[] = []
    let failedCount = 0
    for (const part of parts) {
      if (
        part.state === "output-error" ||
        (settled && part.state !== "output-available")
      ) {
        failedCount++
        continue
      }
      if (part.state !== "output-available") continue
      if (part.type === "tool-findProjectDocuments") {
        segments.push(`找到 ${part.output.length} 份候选文档`)
      } else if (part.type === "tool-readProjectDocument") {
        segments.push(
          `已读取「${part.output.revision.title}」V${part.output.revision.revisionNumber}`
        )
      } else {
        const out = part.output
        segments.push(
          out.status === "committed"
            ? "已保存修改"
            : out.status === "unchanged"
              ? "无需修改"
              : out.status === "conflict"
                ? "版本冲突"
                : "未保存"
        )
      }
    }
    if (failedCount) segments.push(`${failedCount} 项失败`)
    return segments.join(" · ") || "文档操作完成"
  })()

  return (
    <div className="thinking-trace bui">
      <ThinkingState
        variant="Search"
        working={working}
        active={active}
        done={done}
        icon={<FileText aria-hidden className="size-3.5" />}
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
  const finished = toolState === "output-available" || toolState === "output-error"
  const secondary = progress?.partialTitle
    ? progress.characterCount > 0
      ? `${progress.partialTitle} · ${progress.characterCount} 字`
      : progress.partialTitle
    : progress && progress.characterCount > 0
      ? `${progress.characterCount} 字`
      : undefined

  return (
    <div className="thinking-trace bui">
      <ThinkingState
        variant="Coding"
        working={!finished}
        active="正在生成文档"
        done={toolState === "output-error" ? "生成失败" : "已生成文档"}
        rows={[{ primary: "生成文档", secondary, mono: true }]}
      />
    </div>
  )
}
