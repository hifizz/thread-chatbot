import type { UIMessage, UIMessageChunk } from "ai"
import type {
  MarkdownArtifactInput,
  MarkdownArtifactProgressEvent,
} from "@/lib/chat/markdown-artifact"
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"
import type {
  ResearchPlan,
  ResearchRoute,
} from "@/lib/chat/research-contract"

export interface ThreadChatMessageMetadata {
  messageId: string
  threadId: string
  modelId?: string
}

export type ThreadChatDataParts = {
  quote: { text: string }
  "research-activity": WebResearchActivity
  "research-route": ResearchRoute
  "research-plan": ResearchPlan
  "artifact-progress": MarkdownArtifactProgressEvent
}

export interface MarkdownArtifactOutput {
  created: true
  artifactId: string
}

export type WebSearchOutput = {
  query: string
  results: Array<{ title: string; url: string; snippet: string }>
}

export type ThreadChatTools = {
  createMarkdownArtifact: {
    input: MarkdownArtifactInput
    output: MarkdownArtifactOutput
  }
  webSearch: {
    input: { query: string }
    output: WebSearchOutput
  }
  readUrl: {
    input: { url: string }
    output: { url: string; content: string }
  }
}

/**
 * AI SDK v7 的三层协议必须保持分离：
 * - `streamText(...).stream` 产生 TextStreamPart；
 * - 独立 `toUIMessageStream({ stream })` 产生 UIMessageChunk；
 * - `readUIMessageStream({ stream })` 归并成这里的 UIMessage.parts[]。
 *
 * 安装版依据：node_modules/ai/dist/index.d.ts。不要使用已废弃的
 * StreamTextResult 实例 `toUIMessageStream()`，也不要退化为 textStream。
 */
export type ThreadChatUIMessage = UIMessage<
  ThreadChatMessageMetadata,
  ThreadChatDataParts,
  ThreadChatTools
>

export type ThreadChatUIMessageChunk = UIMessageChunk<
  ThreadChatMessageMetadata,
  ThreadChatDataParts
>

export function isThreadChatUIMessage(
  value: unknown
): value is ThreadChatUIMessage {
  if (typeof value !== "object" || value === null) return false
  const message = value as Record<string, unknown>
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    Array.isArray(message.parts)
  )
}

export function isThreadChatUIMessageChunk(
  value: unknown
): value is ThreadChatUIMessageChunk {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).type === "string"
  )
}
