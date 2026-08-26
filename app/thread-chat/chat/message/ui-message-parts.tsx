"use client"

import type { ConversationViewMessage } from "../../core/types"

/**
 * text/data-artifact/data-research 仍由现有正文、Artifact 卡和研究面板渲染；
 * 这里仅补齐此前没有平行字段的 reasoning/source/file/tool parts。
 */
export function UIMessageSupplementalParts({
  message,
}: {
  message: ConversationViewMessage
}) {
  const parts = message.uiParts ?? []
  const reasoning = parts.filter(
    (part): part is Extract<typeof part, { type: "reasoning" }> =>
      part.type === "reasoning" && Boolean(part.text.trim())
  )
  const sources = parts.filter((part) => part.type === "source-url")
  const files = parts.filter((part) => part.type === "file")
  const tools = parts.filter((part) => part.type.startsWith("tool-"))
  if (
    reasoning.length === 0 &&
    sources.length === 0 &&
    files.length === 0 &&
    tools.length === 0
  )
    return null

  return (
    <div data-ui-message-supplemental="true">
      {reasoning.length > 0 && (
        <details className="inherited">
          <summary>思考过程</summary>
          <div className="inherited-body">
            {reasoning.map((part, index) => (
              <p key={index}>{part.text}</p>
            ))}
          </div>
        </details>
      )}
      {files.map((part, index) => (
        <a key={`${part.url}-${index}`} href={part.url} download={part.filename}>
          {part.filename ?? "附件"}
        </a>
      ))}
      {sources.map((part, index) => (
        <a
          key={`${part.url}-${index}`}
          href={part.url}
          target="_blank"
          rel="noreferrer"
        >
          {part.title ?? part.url}
        </a>
      ))}
      {tools.map((part, index) => {
        const state = "state" in part ? String(part.state) : ""
        return (
          <span key={`${part.type}-${index}`} hidden={state === "output-available"}>
            {state ? `工具：${state}` : ""}
          </span>
        )
      })}
    </div>
  )
}

