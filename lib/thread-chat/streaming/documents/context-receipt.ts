import { DOCUMENT_RECEIPT_KIND } from "@/constants/project-documents"
import { documentContextReceiptSchema, type DocumentContextReceipt } from "../../contracts/document"
import type { ThreadChatUIMessage } from "../../contracts/ui-message"

/** 消息 Part 已有明确类型，不再丢弃标签后让下游猜测 data 的形状。 */
export function documentReceiptForParts(parts: ThreadChatUIMessage["parts"]): DocumentContextReceipt | undefined {
  for (const part of parts) {
    if (part.type === "data-project-document-updates") {
      return documentContextReceiptSchema.parse({ ...part.data, kind: DOCUMENT_RECEIPT_KIND.updates })
    }
    if (part.type === "data-document-update-notices") {
      return documentContextReceiptSchema.parse({ ...part.data, kind: DOCUMENT_RECEIPT_KIND.notices })
    }
  }
}

/** 提供商返回有效内容后才记录使用；只有 stream-start/error 的拒绝不消费进展。 */
export function withDocumentContextReceipt<T extends { type: string }>(
  stream: ReadableStream<T>,
  record: () => Promise<void>,
): ReadableStream<T> {
  let recorded = false
  return stream.pipeThrough(new TransformStream<T, T>({
    async transform(part, controller) {
      if (!recorded && ["text-start", "text-delta", "reasoning-start", "reasoning-delta", "tool-input-start", "tool-call", "file"].includes(part.type)) {
        await record()
        recorded = true
      }
      controller.enqueue(part)
    },
  }))
}
