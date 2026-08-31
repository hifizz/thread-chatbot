import { THREAD_QUOTE_MAX_COUNT } from "@/constants/thread-chat"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import {
  quoteSelectionKey,
  type QuoteSelectionInput,
} from "@/lib/thread-chat/domain/thread-quote"

export type ComposerDraftFile = {
  url: string
  mediaType: string
  filename?: string
}

export type ComposerQuoteDraftOrigin =
  | "branch-origin"
  | "manual-selection"
  | "artifact-annotation"

export type ComposerQuoteDraftItem = {
  /** 仅用于未发送 Draft；服务端会生成持久化 quoteId。 */
  draftId: string
  origin: ComposerQuoteDraftOrigin
  source: QuoteSelectionInput["source"]
  previewText: string
  comment: string
  /** Fork 第一轮 origin 必须存在、排第一且不进入普通 quotes[]。 */
  required: boolean
}

export type ThreadComposerDraft = {
  text: string
  quotes: ComposerQuoteDraftItem[]
  files: ComposerDraftFile[]
}

export type ComposerSubmission = {
  text: string
  files: ComposerDraftFile[]
  quotes: QuoteSelectionInput[]
}

export function emptyThreadComposerDraft(): ThreadComposerDraft {
  return { text: "", quotes: [], files: [] }
}

function draftSelection(item: ComposerQuoteDraftItem): QuoteSelectionInput {
  const comment = item.comment.trim()
  return {
    source: item.source,
    ...(comment ? { comment } : {}),
  }
}

export function composerQuoteDraftKey(item: ComposerQuoteDraftItem): string {
  return quoteSelectionKey(draftSelection(item))
}

export function normalizeComposerDraft(
  draft: ThreadComposerDraft
): ThreadComposerDraft {
  const required = draft.quotes.filter((quote) => quote.required)
  if (required.length > 1) {
    throw new Error("COMPOSER_MULTIPLE_REQUIRED_ORIGIN")
  }
  const ordered = required.length
    ? [required[0], ...draft.quotes.filter((quote) => !quote.required)]
    : [...draft.quotes]
  const seen = new Set<string>()
  const quotes = ordered.filter((quote) => {
    const key = composerQuoteDraftKey(quote)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (quotes.length > THREAD_QUOTE_MAX_COUNT) {
    throw new Error("COMPOSER_QUOTE_LIMIT_EXCEEDED")
  }
  return { ...draft, quotes }
}

export function addComposerQuote(
  draft: ThreadComposerDraft,
  quote: ComposerQuoteDraftItem
): ThreadComposerDraft {
  const normalized = normalizeComposerDraft(draft)
  const key = composerQuoteDraftKey(quote)
  if (normalized.quotes.some((item) => composerQuoteDraftKey(item) === key)) {
    return normalized
  }
  if (normalized.quotes.length >= THREAD_QUOTE_MAX_COUNT) {
    throw new Error("COMPOSER_QUOTE_LIMIT_EXCEEDED")
  }
  return normalizeComposerDraft({
    ...normalized,
    quotes: quote.required
      ? [quote, ...normalized.quotes]
      : [...normalized.quotes, quote],
  })
}

export function removeComposerQuote(
  draft: ThreadComposerDraft,
  draftId: string
): ThreadComposerDraft {
  const target = draft.quotes.find((quote) => quote.draftId === draftId)
  if (target?.required) throw new Error("COMPOSER_REQUIRED_QUOTE")
  return { ...draft, quotes: draft.quotes.filter((quote) => quote.draftId !== draftId) }
}

export function moveComposerQuote(
  draft: ThreadComposerDraft,
  draftId: string,
  nextIndex: number
): ThreadComposerDraft {
  const normalized = normalizeComposerDraft(draft)
  const currentIndex = normalized.quotes.findIndex(
    (quote) => quote.draftId === draftId
  )
  if (currentIndex === -1) return normalized
  const target = normalized.quotes[currentIndex]
  if (target.required) return normalized
  const firstMovableIndex = normalized.quotes[0]?.required ? 1 : 0
  const boundedIndex = Math.max(
    firstMovableIndex,
    Math.min(nextIndex, normalized.quotes.length - 1)
  )
  const quotes = [...normalized.quotes]
  quotes.splice(currentIndex, 1)
  quotes.splice(boundedIndex, 0, target)
  return { ...normalized, quotes }
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
  const normalized = normalizeComposerDraft(draft)
  if (!isComposerDraftSendable(normalized)) {
    throw new Error("COMPOSER_DRAFT_NOT_SENDABLE")
  }
  return {
    text: normalized.text.trim(),
    files: [...normalized.files],
    quotes: normalized.quotes
      .filter((quote) => !quote.required)
      .map(draftSelection),
  }
}

export function branchOriginDraftQuote(input: {
  draftId: string
  sourceMessageId: string
  anchor: TextAnchor
  previewText: string
}): ComposerQuoteDraftItem {
  if (input.anchor.quote.exact !== input.previewText) {
    throw new Error("COMPOSER_ORIGIN_ANCHOR_MISMATCH")
  }
  return {
    draftId: input.draftId,
    origin: "branch-origin",
    source: {
      type: "message-selection",
      sourceMessageId: input.sourceMessageId,
      anchor: input.anchor,
    },
    previewText: input.previewText,
    comment: "",
    required: true,
  }
}
