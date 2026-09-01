import { createHash } from "node:crypto"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { parseThreadQuoteData } from "@/lib/thread-chat/domain/thread-quote"
import { THREAD_QUOTE_TOKEN_ESTIMATE_CHARACTERS } from "@/constants/thread-chat-quote"

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Prompt hash cannot encode non-finite numbers")
    return value
  }
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString("base64") }
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined && typeof item !== "function")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    )
  }
  throw new Error(`Prompt hash cannot encode ${typeof value}`)
}

export function stablePromptStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function promptContentHash(value: unknown): string {
  return createHash("sha256").update(stablePromptStringify(value)).digest("hex")
}

export function promptVisibleCharacters(value: unknown): number {
  return stablePromptStringify(value).length
}

export function estimatePromptTokens(characters: number): number {
  return Math.ceil(characters / THREAD_QUOTE_TOKEN_ESTIMATE_CHARACTERS)
}

export function currentUserQuoteSummary(message: ThreadChatUIMessage): {
  count: number
  characters: number
} {
  const quotes = message.parts.flatMap((part) => {
    if (part.type !== "data-quote") return []
    return [parseThreadQuoteData(part.data)]
  })
  return {
    count: quotes.length,
    characters: quotes.reduce(
      (total, quote) =>
        total + quote.text.length + (quote.comment?.length ?? 0),
      0
    ),
  }
}
