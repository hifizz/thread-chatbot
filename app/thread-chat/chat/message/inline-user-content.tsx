"use client"

import type { ConversationViewMessage } from "../../core/types"
import { useArtifactResources } from "../composer/artifact-composer-context"

/** 行内引用与文字按持久化 Parts 顺序展示，不能先合并所有文字再另列引用。 */
export function InlineUserContent({ message }: { message: ConversationViewMessage }) {
  const resources = useArtifactResources()
  if (!message.uiParts) return <>{message.quote && <div className="msg-quote">{message.quote.text}</div>}{message.text}</>
  return <>{message.uiParts.map((part, index) => {
    if (part.type === "text") return <span key={index}>{part.text}</span>
    if (part.type === "data-quote") return <div key={index} className="msg-quote">{part.data.text}</div>
    if (part.type === "data-artifact-reference") return <button
      key={index}
      type="button"
      className="artifact-reference-token"
      title={part.data.title}
      aria-label={`打开 Artifact：${part.data.title}`}
      onClick={() => resources?.openArtifact(part.data.artifactId)}
    >@{part.data.title}</button>
    return null
  })}</>
}
