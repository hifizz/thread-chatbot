import { THREAD_QUOTE_MODEL_FORMAT_VERSION } from "@/constants/thread-chat"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { parseThreadQuoteData } from "@/lib/thread-chat/domain/thread-quote"

export type QuoteModelContent = {
  text: string
  comment?: string
}

export function quoteContentToModelText(content: QuoteModelContent): string {
  const normalized = {
    text: content.text,
    ...(content.comment?.trim()
      ? { comment: content.comment.trim() }
      : {}),
  }
  return [
    `<thread_quote format="${THREAD_QUOTE_MODEL_FORMAT_VERSION}">`,
    JSON.stringify(normalized),
    "</thread_quote>",
  ].join("\n")
}

export function quoteTextToModelText(text: string): string {
  return quoteContentToModelText({ text })
}

/** JSONB/UI Part payloads are untrusted until parsed. */
export function threadQuotePartToModelText(data: unknown): string {
  const quote = parseThreadQuoteData(data)
  return quoteContentToModelText({
    text: quote.text,
    ...(quote.schemaVersion !== "legacy" && quote.comment
      ? { comment: quote.comment }
      : {}),
  })
}

export function quotePartsFromMessage(
  message: Pick<ThreadChatUIMessage, "parts">
): Array<Extract<ThreadChatUIMessage["parts"][number], { type: "data-quote" }>> {
  return message.parts.filter(
    (
      part
    ): part is Extract<
      ThreadChatUIMessage["parts"][number],
      { type: "data-quote" }
    > => part.type === "data-quote"
  )
}

export function quoteModelTextsFromMessage(
  message: Pick<ThreadChatUIMessage, "parts">
): string[] {
  return quotePartsFromMessage(message).map((part) =>
    threadQuotePartToModelText(part.data)
  )
}
