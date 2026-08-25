import type { UIMessage } from "ai"

/** Markdown Artifact 由运行器持久化；AI Runtime 只返回待投影的工具结果。 */
export type MarkdownArtifactRuntimeOutput = {
  kind: "markdown"
  title: string
  content: string
  toolCallId?: string
}

/** AI Runtime 的供应商无关输出；持久化游标由 MessageRun runner 分配。 */
export type AiRuntimeEvent =
  | { type: "delta"; partsDelta: UIMessage["parts"] }
  | { type: "artifact"; output: MarkdownArtifactRuntimeOutput }
  | { type: "completed"; parts: UIMessage["parts"] }
  | { type: "failed"; error: { code: string; message: string } }
  | { type: "stopped" }

export type AiRuntimeRequest = {
  messageRunId: string
  assistantMessageId: string
  modelId: string
  prompt: UIMessage[]
}

/**
 * MessageRun 执行器只依赖此 capability。真实供应商与测试 Fake 都必须实现它，
 * 浏览器订阅生命周期不得直接控制这里的 AbortSignal。
 */
export interface AiRuntime {
  execute(
    request: AiRuntimeRequest,
    options?: { signal?: AbortSignal }
  ): AsyncIterable<AiRuntimeEvent>
}
