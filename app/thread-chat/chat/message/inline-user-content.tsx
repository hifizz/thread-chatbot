"use client"
import type { ConversationViewMessage } from "../../core/types"
import { useArtifactNavigation } from "../composer/artifact-resources"
import { UIMessageSupplementalParts } from "./ui-message-parts"
import { useI18n } from "@/lib/i18n/client"


type OpenArtifact = NonNullable<ReturnType<typeof useArtifactNavigation>>
type QuotePart = Extract<
  NonNullable<ConversationViewMessage["uiParts"]>[number],
  { type: "data-quote" }
>

function QuoteContent({ part, open }: { part: QuotePart; open: OpenArtifact | null }) {
  const { t } = useI18n()

  const data = part.data
  // legacy data-quote 只有 text；V1 才有 source，进一步收窄出 artifact 来源
  const artifactSource =
    "source" in data && data.source.type === "artifact" ? data.source : null
  const body = (
    <>
      {data.text}
      {"comment" in data && data.comment ? <small>{data.comment}</small> : null}
    </>
  )
  if (!artifactSource) {
    return (
      <span className="msg-quote" title={data.text}>
        {body}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="msg-quote msg-quote-source"
      title={t("ui.openTheReferencedArtifactAtThe")}
      disabled={!open}
      onClick={() => open?.(artifactSource.artifactId, artifactSource.anchor)}
    >
      {body}
    </button>
  )
}

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
        if (part.type === "data-project-document-updates" || part.type === "data-document-update-notices") return null
        if (part.type === "text") return <span key={index}>{part.text}</span>
        if (part.type === "data-quote")
          return <QuoteContent key={index} part={part} open={open} />
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
