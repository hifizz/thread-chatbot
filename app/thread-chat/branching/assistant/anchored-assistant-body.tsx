"use client"

import type { MarkdownDensity } from "../../chat/message/markdown-body"
import type { ConversationViewMessage, ThreadTreeState } from "../../core/types"
import { AssistantTrace } from "./assistant-trace"
import { AnchoredMarkdown } from "./anchored-markdown"
import { assistantPartRenderPlan } from "./assistant-part-render-plan"

export function AnchoredAssistantBody({
  state,
  message,
  onOpenThread,
  density = "default",
}: {
  state: ThreadTreeState
  message: ConversationViewMessage
  onOpenThread: (targetId: string, opts?: { keepSource?: boolean }) => void
  density?: MarkdownDensity
}) {
  const renderPlan = assistantPartRenderPlan(message)

  return (
    <>
      {renderPlan.map((item, position) => {
        if (item.kind === "trace") {
          return <AssistantTrace
            key={`trace-${item.index}`}
            items={item.items}
            status={message.status}
            plan={message.researchPlan}
            active={(message.status === "pending" || message.status === "streaming") && position === renderPlan.length - 1}
          />
        }
        const { kind, part, index } = item
        if (kind === "text" && part.type === "text") {
          return (
            <AnchoredMarkdown
              key={`${part.type}-${index}`}
              state={state}
              msg={message}
              source={part.text}
              onOpenThread={onOpenThread}
              density={density}
            />
          )
        }

        if (
          kind === "file" &&
          (part.type === "file" || part.type === "reasoning-file")
        ) {
          return (
            <a
              key={`${part.type}-${part.url}-${index}`}
              href={part.url}
              download={part.type === "file" ? part.filename : undefined}
            >
              {part.type === "file" ? (part.filename ?? "附件") : "推理文件"}
            </a>
          )
        }

        if (kind === "source-url" && part.type === "source-url") {
          return (
            <a
              key={`${part.type}-${part.url}-${index}`}
              href={part.url}
              target="_blank"
              rel="noreferrer"
            >
              {part.title ?? part.url}
            </a>
          )
        }

        if (kind === "tool") {
          const toolState = "state" in part ? String(part.state) : ""
          return (
            <span
              key={`${part.type}-${index}`}
              hidden={toolState === "output-available"}
            >
              {toolState ? `工具：${toolState}` : ""}
            </span>
          )
        }

        return null
      })}
    </>
  )
}
