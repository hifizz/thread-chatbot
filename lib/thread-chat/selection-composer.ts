import {
  THREAD_QUOTE_SCHEMA_VERSION,
  threadQuoteDataV1Schema,
  type ThreadQuoteDataV1,
} from "./contracts/quote"
import type { TextAnchor } from "./domain/text-anchor"

/** 冻结选文及来源，复用现有 Quote 协议，不把引用拼进可编辑正文。 */
export function selectionComposerQuote(selection: {
  text: string
  msgId: string
  anchor: TextAnchor
}): ThreadQuoteDataV1 {
  return threadQuoteDataV1Schema.parse({
    schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
    text: selection.text,
    source: {
      type: "message",
      messageId: selection.msgId,
      anchor: selection.anchor,
    },
  })
}

/** 同一来源的同一选区只加入一次；不同消息中的相同文字仍是不同引用。 */
export function appendSelectionQuote(
  quotes: ThreadQuoteDataV1[],
  quote: ThreadQuoteDataV1
): ThreadQuoteDataV1[] {
  const key = JSON.stringify(quote)
  return quotes.some((current) => JSON.stringify(current) === key)
    ? quotes
    : [...quotes, quote]
}
