import { THREAD_QUOTE_MAX_COUNT } from "@/constants/thread-chat-quote"
import type { QuoteSelectionInput } from "@/lib/thread-chat/contracts/quote-selection"
import { threadQuoteAnchorKey } from "@/lib/thread-chat/domain/thread-quote"

export interface CommandFileReference {
  url: string
  mediaType: string
  filename?: string
}

export type ComposerQuoteDraftItem =
  | {
      draftId: string
      origin: "branch-origin"
      source: null
      previewText: string
      comment: string
      required: true
    }
  | {
      draftId: string
      origin: "manual-selection" | "artifact-annotation"
      source: QuoteSelectionInput["source"]
      previewText: string
      comment: string
      required: false
    }

export interface ThreadComposerDraft {
  text: string
  quotes: ComposerQuoteDraftItem[]
  files: CommandFileReference[]
}

export interface ComposerSubmission {
  text: string
  files: CommandFileReference[]
  quotes: QuoteSelectionInput[]
}

export function emptyThreadComposerDraft(): ThreadComposerDraft {
  return { text: "", quotes: [], files: [] }
}

function draftSourceKey(item: ComposerQuoteDraftItem): string | null {
  if (!item.source) return null
  const sourceId =
    item.source.type === "message-selection"
      ? item.source.sourceMessageId
      : item.source.artifactId
  return threadQuoteAnchorKey({
    sourceType: item.source.type,
    sourceId,
    anchor: item.source.anchor,
  })
}

export function addComposerQuote(
  draft: ThreadComposerDraft,
  item: ComposerQuoteDraftItem
): { draft: ThreadComposerDraft; existingDraftId: string | null } {
  const key = draftSourceKey(item)
  const duplicate = key
    ? draft.quotes.find((quote) => draftSourceKey(quote) === key)
    : draft.quotes.find((quote) => quote.origin === "branch-origin")
  if (duplicate) return { draft, existingDraftId: duplicate.draftId }
  if (draft.quotes.length >= THREAD_QUOTE_MAX_COUNT) {
    throw new Error(`每条消息最多引用 ${THREAD_QUOTE_MAX_COUNT} 段内容`)
  }
  const quotes = item.required
    ? [item, ...draft.quotes.filter((quote) => !quote.required)]
    : [...draft.quotes, item]
  return { draft: { ...draft, quotes }, existingDraftId: null }
}

export function removeComposerQuote(
  draft: ThreadComposerDraft,
  draftId: string
): ThreadComposerDraft {
  const target = draft.quotes.find((quote) => quote.draftId === draftId)
  if (!target || target.required) return draft
  return {
    ...draft,
    quotes: draft.quotes.filter((quote) => quote.draftId !== draftId),
  }
}

export function moveComposerQuote(
  draft: ThreadComposerDraft,
  draftId: string,
  targetIndex: number
): ThreadComposerDraft {
  const sourceIndex = draft.quotes.findIndex(
    (quote) => quote.draftId === draftId
  )
  if (sourceIndex < 0 || draft.quotes[sourceIndex]?.required) return draft
  const firstMovable = draft.quotes[0]?.required ? 1 : 0
  const boundedTarget = Math.max(
    firstMovable,
    Math.min(draft.quotes.length - 1, targetIndex)
  )
  const quotes = [...draft.quotes]
  const [item] = quotes.splice(sourceIndex, 1)
  if (!item) return draft
  quotes.splice(boundedTarget, 0, item)
  return { ...draft, quotes }
}

export function updateComposerQuoteComment(
  draft: ThreadComposerDraft,
  draftId: string,
  comment: string
): ThreadComposerDraft {
  return {
    ...draft,
    quotes: draft.quotes.map((quote) =>
      quote.draftId === draftId ? { ...quote, comment } : quote
    ),
  }
}

export function isComposerDraftSendable(draft: ThreadComposerDraft): boolean {
  return (
    draft.text.trim().length > 0 ||
    draft.quotes.some((quote) => quote.comment.trim().length > 0)
  )
}

export function composerDraftToSubmission(
  draft: ThreadComposerDraft
): ComposerSubmission {
  if (!isComposerDraftSendable(draft)) {
    throw new Error("请输入问题，或至少为一份引用填写评论")
  }
  const quotes = draft.quotes.flatMap((quote): QuoteSelectionInput[] => {
    if (quote.required || !quote.source) return []
    const comment = quote.comment.trim()
    return [
      {
        source: quote.source,
        ...(comment ? { comment } : {}),
      },
    ]
  })
  return {
    text: draft.text.trim(),
    files: [...draft.files],
    quotes,
  }
}
