"use client"

import { type FC, useId, useMemo, useState } from "react"
import { useAuiState } from "@assistant-ui/react"
import {
  BookOpenIcon,
  ChevronRightIcon,
  Clock3Icon,
  GlobeIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

// Claude 风格的研究过程面板：把当前消息里的 webSearch / readUrl 工具调用
// 聚成一个可折叠的竖向时间线，展示「搜了什么、读了哪些来源」，完成后显示结果记录。
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

export type ResearchStep =
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

/**
 * 从当前消息的 parts 里按顺序抽取研究步骤。
 *
 * 关键点：selector 只取消息状态里的原始 content 数组引用（在内容未变时引用稳定），
 * 派生的 steps 数组放到 useMemo 里、以该引用为依赖计算。绝不能让 selector 本身
 * 返回一个每次都新建的数组/对象——那样 useSyncExternalStore 每次都会判定"变化了"，
 * 触发无限重渲染（Maximum update depth exceeded）。
 */
function useResearchSteps(): {
  steps: ResearchStep[]
  anyRunning: boolean
} {
  const content = useAuiState((s) => s.message.content) as unknown as ToolPart[]

  return useMemo(() => {
    const steps: ResearchStep[] = []
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
  }, [content])
}

function normalizedUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    return parsed.toString().replace(/\/$/, "")
  } catch {
    return url.replace(/\/$/, "")
  }
}

const SourceRow: FC<{ item: SearchResultItem; visited: boolean }> = ({
  item,
  visited,
}) => {
  const host = hostOf(item.url)
  const [imgOk, setImgOk] = useState(true)
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      title={item.title || host}
      className="grid py-1.5 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-1 px-3 text-sm text-[var(--ink-soft,_#6a6357)] transition-colors hover:bg-[var(--paper-2,_#efe9dd)] hover:text-[var(--ink,_#24211b)] focus-visible:bg-[var(--paper-2,_#efe9dd)] focus-visible:outline-none"
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
        <GlobeIcon className="size-3.5 shrink-0 text-[var(--ink-faint,_#a79e8d)]" />
      )}
      <span className="min-w-0 truncate">{item.title || host}</span>
      <span className="flex max-w-40 shrink-0 items-center gap-1.5 text-xs text-[var(--ink-faint,_#a79e8d)]">
        {visited ? (
          <span title="已读取网页正文" className="inline-flex items-center">
            <BookOpenIcon className="size-3" />
            <span className="sr-only">已读取</span>
          </span>
        ) : null}
        <span className="truncate">{host}</span>
      </span>
    </a>
  )
}

type ResearchGroup = {
  id: string
  kind: "search" | "read"
  title: string
  running: boolean
  results: SearchResultItem[]
}

function researchGroups(steps: ResearchStep[]): {
  groups: ResearchGroup[]
  visitedUrls: Set<string>
} {
  const visitedUrls = new Set(
    steps.flatMap((step) =>
      step.kind === "read" ? [normalizedUrl(step.url)] : []
    )
  )
  const searchedUrls = new Set(
    steps.flatMap((step) =>
      step.kind === "search"
        ? step.sources.map((source) => normalizedUrl(source.url))
        : []
    )
  )
  const searchGroups: ResearchGroup[] = []
  const searchGroupByQuery = new Map<string, ResearchGroup>()
  steps.forEach((step, index) => {
    if (step.kind !== "search") return
    const normalizedQuery = step.query.trim().toLowerCase().replace(/\s+/g, " ")
    const key = normalizedQuery || `pending-${index}`
    const existing = searchGroupByQuery.get(key)
    if (existing) {
      existing.running ||= step.running
      const knownUrls = new Set(
        existing.results.map((source) => normalizedUrl(source.url))
      )
      for (const source of step.sources) {
        const url = normalizedUrl(source.url)
        if (knownUrls.has(url)) continue
        knownUrls.add(url)
        existing.results.push(source)
      }
      return
    }

    const group: ResearchGroup = {
      id: `search-${index}`,
      kind: "search",
      title: step.query || "正在生成搜索词…",
      running: step.running,
      results: [...step.sources],
    }
    searchGroupByQuery.set(key, group)
    searchGroups.push(group)
  })

  // 已失败且没有结果的内部重试不单独暴露给用户；如果全部为空，保留一组作为总体状态。
  const visibleSearchGroups = searchGroups.filter(
    (group) => group.running || group.results.length > 0
  )
  const groups =
    visibleSearchGroups.length > 0
      ? visibleSearchGroups
      : searchGroups.slice(0, 1)
  const directReads = steps.filter(
    (step): step is Extract<ResearchStep, { kind: "read" }> =>
      step.kind === "read" && !searchedUrls.has(normalizedUrl(step.url))
  )
  if (directReads.length > 0) {
    groups.push({
      id: "direct-reads",
      kind: "read",
      title: "访问网页",
      running: directReads.some((step) => step.running),
      results: directReads.map((step) => ({
        title: hostOf(step.url),
        url: step.url,
        snippet: "",
      })),
    })
  }
  return { groups, visitedUrls }
}

/** 容器：从消息状态读取研究步骤，交给纯展示组件 */
export const ResearchProgress: FC = () => {
  const { steps, anyRunning } = useResearchSteps()
  if (steps.length === 0) return null
  return <ResearchPanelView steps={steps} anyRunning={anyRunning} />
}

/** 纯展示：给定步骤即渲染面板（无 assistant-ui 依赖，便于预览/测试） */
export const ResearchPanelView: FC<{
  steps: ResearchStep[]
  anyRunning: boolean
  complete?: boolean
  title?: string
  completionText?: string
  plan?: { goal: string }
}> = ({
  steps,
  anyRunning,
  complete,
  title = "联网搜索",
  completionText,
  plan,
}) => {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const { groups, visitedUrls } = useMemo(() => researchGroups(steps), [steps])
  const isDirectFetch = title === "网页读取"
  const triggerLabel = anyRunning
    ? isDirectFetch
      ? "正在读取网页"
      : "正在搜索网络"
    : isDirectFetch
      ? "已读取网页"
      : "已搜索网络"
  const outcome =
    completionText ??
    (plan
      ? `完成了「${plan.goal}」的资料检索与回答。`
      : `完成了 ${groups.length} 组联网检索并整理了回答。`)
  // 工具批次之间 anyRunning 会短暂变为 false；最终记录只能在整条回答完成后出现。
  const showOutcome = complete ?? !anyRunning

  return (
    <section
      data-slot="research-panel"
      className="mt-3 mb-3 min-w-0 text-[var(--ink,_#24211b)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="group flex items-center gap-1.5 rounded-sm py-0.5 text-left text-sm text-[var(--ink-faint,_#a79e8d)] transition-colors hover:text-[var(--ink,_#24211b)] focus-visible:text-[var(--ink,_#24211b)] focus-visible:ring-2 focus-visible:ring-[var(--d1,_#2f7d6b)]/25 focus-visible:outline-none"
      >
        <span className={cn(anyRunning && "shimmer")}>{triggerLabel}</span>
        <span className="sr-only">{open ? "收起详情" : "展开详情"}</span>
        <ChevronRightIcon
          className={cn(
            "size-3.5 opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
            open && "rotate-90 opacity-100"
          )}
        />
      </button>

      {open ? (
        <div
          id={contentId}
          className="relative mt-4 flex min-w-0 flex-col gap-5 pl-0.5"
        >
          <span
            aria-hidden
            className="absolute top-4 bottom-4 left-[11px] w-px bg-[var(--rule,_#e2dccd)]"
          />

          {groups.map((group) => (
            <div key={group.id} className="relative flex min-w-0 gap-3">
              <span
                className={cn(
                  "relative z-10 flex size-6 shrink-0 items-center justify-center bg-[var(--paper,_#f5f2ea)] text-[var(--ink-faint,_#a79e8d)]",
                  group.running && "text-[var(--d1,_#2f7d6b)]"
                )}
              >
                {group.kind === "search" ? (
                  <GlobeIcon className="size-4" />
                ) : (
                  <BookOpenIcon className="size-4" />
                )}
              </span>

              <div className="min-w-0 flex-1 pt-0.5">
                <div className="mb-2 flex min-w-0 items-center gap-3 text-sm">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[var(--ink-soft,_#6a6357)]",
                      group.running && "shimmer"
                    )}
                    title={group.title}
                  >
                    {group.title}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--ink-faint,_#a79e8d)]">
                    {group.running && group.results.length === 0
                      ? "查询中"
                      : `${group.results.length} 个结果`}
                  </span>
                </div>

                {group.results.length > 0 ? (
                  <div className="max-h-[198px] [scrollbar-width:thin] [scrollbar-color:var(--rule,_#a79e8d)_transparent] overflow-y-auto rounded-xl border border-[var(--rule,_#e2dccd)] bg-[color-mix(in_srgb,var(--paper,_#f5f2ea)_82%,white)]">
                    <div role="list">
                      {group.results.map((source, index) => (
                        <div
                          role="listitem"
                          key={`${source.url}-${index}`}
                          className=" border-[var(--rule,_#e2dccd)] last:border-b-0"
                        >
                          <SourceRow
                            item={source}
                            visited={visitedUrls.has(normalizedUrl(source.url))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    className={cn(
                      "text-xs text-[var(--ink-faint,_#a79e8d)]",
                      group.running && "shimmer"
                    )}
                  >
                    {group.running ? "正在获取结果…" : "暂无可展示结果"}
                  </div>
                )}
              </div>
            </div>
          ))}

          {showOutcome ? (
            <div className="relative flex min-w-0 gap-3">
              <span className="relative z-10 flex size-6 shrink-0 items-center justify-center bg-[var(--paper,_#f5f2ea)] text-[var(--ink-faint,_#a79e8d)]">
                <Clock3Icon className="size-4" />
              </span>
              <p className="min-w-0 flex-1 pt-0.5 text-sm text-[var(--ink-soft,_#6a6357)]">
                {outcome}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
