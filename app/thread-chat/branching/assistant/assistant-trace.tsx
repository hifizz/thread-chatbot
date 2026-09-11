"use client"

import { useId, useState } from "react"
import { ScrollShadow } from "@heroui/react/scroll-shadow"
import { ArrowUpRight, BookOpen, ChevronDown, LoaderCircle, Search, Sparkles, Wrench } from "lucide-react"
import { ThinkingText } from "../../chat/message/thinking-status"
import { ASSISTANT_THINKING_LABEL, ASSISTANT_TRACE_SHADOW_SIZE, ASSISTANT_TRACE_TOOL_LABELS } from "@/constants/assistant-trace"
import type { ResearchPlan } from "@/lib/chat/research-contract"
import { researchQuestionForReasoning, traceSourceHref, traceToolFromPart, unfinishedTracePhase, type TraceTool } from "@/lib/chat/assistant-trace"
import type { MessageStatus } from "../../core/types"
import type { AssistantTraceItem } from "./assistant-part-render-plan"

function TraceToolCard({ tool }: { tool: TraceTool }) {
  return <details className="assistant-trace-tool" data-phase={tool.phase}>
    <summary>
      {tool.name === "webSearch" ? <Search size={14} /> : tool.name === "readUrl" ? <BookOpen size={14} /> : <Wrench size={14} />}
      <span className="assistant-trace-tool-label" title={tool.input}>{tool.input || ASSISTANT_TRACE_TOOL_LABELS[tool.name] || "查看详情"}</span>
      {tool.phase === "running" && <LoaderCircle size={12} className="assistant-trace-spin" />}
      <ChevronDown size={12} className="assistant-trace-chevron" />
    </summary>
    <div className="assistant-trace-tool-body">
      {tool.input && <p>{tool.input}</p>}
      {tool.sources.length > 0 && <ul className="assistant-trace-sources">{tool.sources.map((source) => {
        const href = traceSourceHref(source.url)
        return <li key={source.url}>{href ? <a href={href} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={12} /></a> : <span>{source.title}</span>}</li>
      })}</ul>}
      {tool.name === "readUrl" && tool.phase === "complete" && traceSourceHref(tool.input) && <a className="assistant-trace-source-link" href={traceSourceHref(tool.input)} target="_blank" rel="noreferrer">查看原文<ArrowUpRight size={12} /></a>}
      {tool.phase === "error" && <p className="assistant-trace-note">这次未获取到内容。</p>}
      {tool.phase === "stopped" && <p>请求已停止，保留已收到的内容。</p>}
      {tool.name === "webSearch" && tool.phase === "complete" && tool.sources.length === 0 && <p>未找到可用来源。</p>}
    </div>
  </details>
}

/** 每段 reasoning 自己拥有一个标题和正文滚动区，不再套总的思考容器。 */
function ReasoningSection({ text, title, status, active }: {
  text: string
  title?: string
  status: MessageStatus | undefined
  active: boolean
}) {
  const contentId = useId()
  const lifecycle = status ?? "done"
  const [expandedStatus, setExpandedStatus] = useState<MessageStatus | null>(null)
  const expanded = expandedStatus !== null && expandedStatus === lifecycle
  const label = title ?? ASSISTANT_THINKING_LABEL

  return <section className="assistant-trace" data-ui-message-part="reasoning" data-active={active}>
    <button type="button" className="assistant-trace-toggle" aria-expanded={expanded} aria-controls={contentId} disabled={!text.trim()} onClick={() => setExpandedStatus(expanded ? null : lifecycle)}>
      <Sparkles size={14} /><span className="assistant-trace-title" title={label}>{active ? <ThinkingText title={label} /> : label}</span>
      {text.trim() && <ChevronDown size={14} className="assistant-trace-chevron" />}
    </button>
    <div id={contentId} className="assistant-trace-expand" data-expanded={expanded} inert={!expanded}>
      <div className="assistant-trace-clip">{expanded && <ScrollShadow className="assistant-trace-scroll" size={ASSISTANT_TRACE_SHADOW_SIZE} tabIndex={0} role="region" aria-label="思考内容">
        <p className="assistant-trace-reasoning">{text}</p>
      </ScrollShadow>}</div>
    </div>
  </section>
}

/** 按原始 part 顺序输出同级区块；研究计划只供标题匹配，不额外展示一层。 */
export function AssistantTrace({ items, status, active, plan }: {
  items: AssistantTraceItem[]
  status: MessageStatus | undefined
  active: boolean
  plan?: ResearchPlan
}) {
  const parts = items.map(({ part }) => part)
  return <>{items.map(({ part, index }, position) => {
    if (part.type === "reasoning") {
      const running = part.state !== "done" && unfinishedTracePhase(status) === "running"
      if (!part.text.trim() && !running) return null
      return <ReasoningSection key={`reasoning-${index}`} text={part.text} title={researchQuestionForReasoning(plan, parts, position)} status={status} active={active && running} />
    }
    const tool = traceToolFromPart(part, status)
    return tool ? <section key={tool.id} className="assistant-trace" data-ui-message-part="tool" data-tool-call-id={tool.id}><TraceToolCard tool={tool} /></section> : null
  })}</>
}
