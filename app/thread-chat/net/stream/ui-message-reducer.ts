import { readUIMessageStream } from "ai"
import type {
  ThreadChatUIMessage,
  ThreadChatUIMessageChunk,
} from "@/lib/thread-chat/contracts/ui-message"

/**
 * 交给安装版 AI SDK v7 的 UI Message reducer 解释 chunk；客户端不自行维护
 * text delta、tool 状态或 reasoning/source/file 的平行状态机。
 */
export async function reduceThreadChatUIMessage(
  message: ThreadChatUIMessage,
  chunk: ThreadChatUIMessageChunk
): Promise<ThreadChatUIMessage> {
  const stream = new ReadableStream<ThreadChatUIMessageChunk>({
    start(controller) {
      controller.enqueue(chunk)
      controller.close()
    },
  })
  let current = message
  for await (const next of readUIMessageStream<ThreadChatUIMessage>({
    message,
    stream,
    terminateOnError: true,
  })) {
    current = next
  }
  return current
}

