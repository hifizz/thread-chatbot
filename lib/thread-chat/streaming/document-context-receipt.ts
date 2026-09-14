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
