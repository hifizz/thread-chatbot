import type { ModelMessage } from "ai"

/**
 * 将服务端已完成的搜索表示成标准 assistant tool-call + tool-result，确保首个模型
 * step 看见的证据与 UI 展示的是同一份工具输出。
 */
export function appendServerForcedSearchResult({
  messages,
  toolCallId,
  toolName,
  query,
  output,
}: {
  messages: ModelMessage[]
  toolCallId: string
  toolName: string
  query: string
  output: unknown
}): ModelMessage[] {
  return [
    ...messages,
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId,
          toolName,
          input: { query },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName,
          output: { type: "json", value: output as never },
        },
      ],
    },
  ]
}
