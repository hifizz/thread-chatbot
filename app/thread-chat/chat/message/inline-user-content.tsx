"use client"
import { ARTIFACT_SOURCE_NAVIGATION_EVENT } from "@/constants/artifact-navigation"
import { persistedThreadQuotePartSchema } from "@/lib/thread-chat/contracts/quote"
import type { ConversationViewMessage } from "../../core/types"
import { useArtifactNavigation } from "../composer/artifact-resources"
import { UIMessageSupplementalParts } from "./ui-message-parts"

export function InlineUserContent({ message }: { message: ConversationViewMessage }) {
  const open = useArtifactNavigation()
  if (!message.uiParts)
    return (
      <>
        {message.quote && <div className="msg-quote">{message.quote.text}</div>}
        {message.text}
      </>
    )
  return (
    <>
      {message.uiParts.map((part, index) => {
        if (part.type === "text") return <span key={index}>{part.text}</span>
        if (part.type === "data-quote") {
          const parsed = persistedThreadQuotePartSchema.safeParse(part)
          const quote = parsed.success ? parsed.data.data : null
          const artifactSource =
            quote &&
            "schemaVersion" in quote &&
            quote.source.type === "artifact"
              ? quote.source
              : null
          const body = (
            <>
              {part.data.text}
              {"comment" in part.data && part.data.comment ? (
                <small>{part.data.comment}</small>
              ) : null}
            </>
          )
          if (!artifactSource)
            return (
              <span key={index} className="msg-quote" title={part.data.text}>
                {body}
              </span>
            )
          return (
            <button
              key={index}
              type="button"
              className="msg-quote msg-quote-source"
              title="打开引用的 Artifact 并定位原文"
              disabled={!open}
              onClick={() => {
                open?.(artifactSource.artifactId)
                window.dispatchEvent(
                  new CustomEvent(ARTIFACT_SOURCE_NAVIGATION_EVENT, {
                    detail: {
                      artifactId: artifactSource.artifactId,
                      anchor: artifactSource.anchor,
                    },
                  })
                )
              }}
            >
              {body}
            </button>
          )
        }
        if (part.type === "data-artifact-reference")
          return (
            <button
              key={index}
              className="composer-capsule"
              type="button"
              disabled={!open}
              onClick={() => open?.(part.data.artifactId)}
            >
              @{part.data.title}
            </button>
          )
        if (part.type === "file")
          return (
            <UIMessageSupplementalParts
              key={index}
              message={{ ...message, uiParts: [part] }}
            />
          )
        return null
      })}
    </>
  )
}
