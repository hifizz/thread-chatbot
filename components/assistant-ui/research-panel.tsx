"use client"

import { type FC, type ReactNode, useState } from "react"
import { useAuiState } from "@assistant-ui/react"
import { useShallow } from "zustand/shallow"
import {
  TelescopeIcon,
  SearchIcon,
  BookOpenIcon,
  ChevronDownIcon,
  GlobeIcon,
  Loader2Icon,
  CheckIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

// grok DeepSearch 风格的研究过程面板：把当前消息里的 webSearch / readUrl 工具调用
// 聚成一个可折叠的竖向时间线，展示「搜了什么、读了哪些来源」，完成后收起为摘要。
// 直接从消息 parts 读取，不依赖 assistant-ui 的分组行为，稳健。

export const RESEARCH_TOOL_NAMES = new Set(["webSearch", "readUrl"])

type SearchResultItem = { title: string; url: string; snippet: string }
type ToolPart = {
  type: string
  toolName?: string
  args?: { query?: string; url?: string }
  result?: {
    query?: string
    url?: string
    results?: SearchResultItem[]
  }
  status?: { type?: string }
}

type Step =
  | {
      kind: "search"
      query: string
      sources: SearchResultItem[]
      running: boolean
    }
  | { kind: "read"; url: string; running: boolean }

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** 从当前消息的 parts 里按顺序抽取研究步骤 */
function useResearchSteps(): { steps: Step[]; anyRunning: boolean } {
  return useAuiState(
    useShallow((s) => {
      const content = (s.message.content ?? []) as unknown as ToolPart[]
      const steps: Step[] = []
      let anyRunning = false
      for (const part of content) {
        if (part.type !== "tool-call" || !part.toolName) continue
        if (!RESEARCH_TOOL_NAMES.has(part.toolName)) continue
        const running = part.status?.type === "running" || part.result == null
        if (running) anyRunning = true
        if (part.toolName === "webSearch") {
          steps.push({
            kind: "search",
            query: part.result?.query ?? part.args?.query ?? "",
            sources: part.result?.results ?? [],
            running,
          })
        } else {
          steps.push({
            kind: "read",
            url: part.result?.url ?? part.args?.url ?? "",
            running,
          })
        }
      }
      return { steps, anyRunning }
    })
  )
}

const SourceChip: FC<{ item: SearchResultItem }> = ({ item }) => {
  const host = hostOf(item.url)
  const [imgOk, setImgOk] = useState(true)
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      title={item.title || host}
      className="flex max-w-[13rem] items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2 py-1 text-xs transition-colors hover:bg-muted"
    >
      {imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s/2/favicons?sz=32&domain=${host}`}
          alt=""
          className="size-3.5 shrink-0 rounded-sm"
          onError={() => setImgOk(false)}
        />
      ) : (
        <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{item.title || host}</span>
    </a>
  )
}

const TimelineNode: FC<{ running: boolean; children: ReactNode }> = ({
  running,
  children,
}) => (
  <span
    className={cn(
      "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background",
      running
        ? "border-primary text-primary"
        : "border-border text-muted-foreground"
    )}
  >
    {children}
  </span>
)

/** 容器：从消息状态读取研究步骤，交给纯展示组件 */
export const ResearchProgress: FC = () => {
  const { steps, anyRunning } = useResearchSteps()
  if (steps.length === 0) return null
  return <ResearchPanelView steps={steps} anyRunning={anyRunning} />
}

/** 纯展示：给定步骤即渲染面板（无 assistant-ui 依赖，便于预览/测试） */
export const ResearchPanelView: FC<{ steps: Step[]; anyRunning: boolean }> = ({
  steps,
  anyRunning,
}) => {
  const [open, setOpen] = useState(true)

  const searchCount = steps.filter((s) => s.kind === "search").length
  const sourceCount = steps.reduce(
    (n, s) => n + (s.kind === "search" ? s.sources.length : 0),
    0
  )
  const summary = anyRunning
    ? "正在研究…"
    : `已完成 · 检索 ${searchCount} 次 · ${sourceCount} 个来源`

  return (
    <div
      data-slot="research-panel"
      className="my-2 overflow-hidden rounded-xl border border-border/60 bg-gradient-to-b from-[color-mix(in_oklab,var(--color-primary)_6%,var(--color-background))] to-background"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <span className="relative flex size-6 items-center justify-center text-primary">
          <TelescopeIcon className="size-4.5" />
          {anyRunning && (
            <span className="absolute inset-0 animate-spin rounded-full border border-primary/40 border-t-primary" />
          )}
        </span>
        <span className="flex flex-1 flex-col">
          <span className="text-sm font-medium">深度研究</span>
          <span className="text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="relative flex flex-col gap-3 px-3.5 pt-1 pb-3.5">
          {/* 竖向时间线 */}
          <span
            aria-hidden
            className="absolute top-2 bottom-4 left-[26px] w-px bg-border"
          />
          {steps.map((step, i) => (
            <div key={i} className="relative flex gap-3">
              {step.kind === "search" ? (
                <>
                  <TimelineNode running={step.running}>
                    {step.running ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <SearchIcon className="size-3.5" />
                    )}
                  </TimelineNode>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                    <span className="text-sm">
                      <span className="text-muted-foreground">搜索</span>{" "}
                      <span className="font-medium">{step.query}</span>
                    </span>
                    {step.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {step.sources.map((src, j) => (
                          <SourceChip key={j} item={src} />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <TimelineNode running={step.running}>
                    {step.running ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <BookOpenIcon className="size-3.5" />
                    )}
                  </TimelineNode>
                  <div className="flex min-w-0 flex-1 items-center gap-2 pt-1 text-sm">
                    <span className="text-muted-foreground">阅读</span>
                    <a
                      href={step.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-primary hover:underline"
                    >
                      {hostOf(step.url)}
                    </a>
                  </div>
                </>
              )}
            </div>
          ))}
          {!anyRunning && (
            <div className="flex items-center gap-1.5 pl-9 text-xs text-muted-foreground">
              <CheckIcon className="size-3.5" />
              研究完成，报告见下方
            </div>
          )}
        </div>
      )}
    </div>
  )
}
