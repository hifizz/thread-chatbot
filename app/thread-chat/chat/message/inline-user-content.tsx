"use client"
import type { ConversationViewMessage } from "../../core/types"
import { useArtifactNavigation } from "../composer/artifact-resources"
import { UIMessageSupplementalParts } from "./ui-message-parts"

export function InlineUserContent({ message }: { message: ConversationViewMessage }) {
  const open = useArtifactNavigation()
  if (!message.uiParts) return <>{message.quote && <div className="msg-quote">{message.quote.text}</div>}{message.text}</>
  return <>{message.uiParts.map((part, index) => {
    if (part.type === "text") return <span key={index}>{part.text}</span>
    if (part.type === "data-quote") return <span key={index} className="msg-quote" title={part.data.text}>{part.data.text}{"comment" in part.data && part.data.comment ? <small>{part.data.comment}</small> : null}</span>
    if (part.type === "data-artifact-reference") return <button key={index} className="composer-capsule" type="button" disabled={!open} onClick={() => open?.(part.data.artifactId)}>@{part.data.title}</button>
    if (part.type === "file") return <UIMessageSupplementalParts key={index} message={{ ...message, uiParts: [part] }} />
    return null
  })}</>
}
