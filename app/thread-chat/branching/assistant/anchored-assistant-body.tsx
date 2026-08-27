"use client"

import type { ConversationViewMessage, ThreadTreeState } from "../../core/types"
import { WebResearchPanel } from "../../orchestration/overlays/web-research-panel"
import { AnchoredMarkdown } from "./anchored-markdown"
import { assistantPartRenderPlan } from "./assistant-part-render-plan"

export function AnchoredAssistantBody({
  state,
  message,
  onOpenThread,
}: {
  state: ThreadTreeState
  message: ConversationViewMessage
  onOpenThread: (targetId: string, opts?: { keepSource?: boolean }) => void
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
            />
          )
        }

        if (kind === "reasoning" && part.type === "reasoning") {
          return (
            <details
              key={`${part.type}-${index}`}
              className="inherited reasoning-part"
              data-ui-message-part="reasoning"
            >
              <summary>思考过程</summary>
              <div className="inherited-body reasoning-body">
                <p>{part.text}</p>
              </div>
            </details>
          )
        }

        if (kind === "research") {
          return (
            <WebResearchPanel
              key={`${part.type}-${index}`}
              activities={message.webResearch ?? []}
              route={message.researchRoute}
              plan={message.researchPlan}
              complete={message.status === "done"}
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
