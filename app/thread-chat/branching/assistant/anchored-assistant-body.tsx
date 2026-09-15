"use client"

import type { MarkdownDensity } from "../../chat/message/markdown-body"
import type { ConversationViewMessage, ThreadTreeState } from "../../core/types"
import { AnchoredMarkdown } from "./anchored-markdown"
import { assistantPartRenderPlan } from "./assistant-part-render-plan"
import { ReasoningTrace, SearchTrace, ToolTrace } from "./thinking-trace"

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
      {renderPlan.map(({ kind, part, index }) => {
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

        if (kind === "reasoning" && part.type === "reasoning") {
          return <ReasoningTrace key={`${part.type}-${index}`} part={part} />
        }

        if (kind === "research" && part.type === "data-research-activity") {
          return (
            <SearchTrace
              key={`${part.type}-${part.data.toolCallId}-${index}`}
              activities={[part.data]}
              route={message.researchRoute}
              complete={message.status === "done"}
              settled={message.status !== "pending" && message.status !== "streaming"}
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

        if (kind === "tool" && part.type === "tool-createMarkdownArtifact") {
          return (
            <ToolTrace
              key={`${part.type}-${index}`}
              toolState={part.state}
              progress={message.markdownGeneration}
            />
          )
        }

        return null
      })}
    </>
  )
}
