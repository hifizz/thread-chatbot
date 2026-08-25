import {
  convertToModelMessages,
  isStepCount,
  streamText,
  tool,
  type LanguageModel,
} from "ai"
import {
  isExplicitMarkdownArtifactRequest,
  MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  MARKDOWN_ARTIFACT_TOOL_NAME,
  markdownArtifactInputSchema,
} from "@/lib/chat/markdown-artifact"
import { resolveChatModel } from "@/lib/ai/provider"
import type {
  AiRuntime,
  AiRuntimeEvent,
  AiRuntimeRequest,
} from "../application/ports/ai-runtime"

const markdownArtifactTool = tool({
  description: MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  inputSchema: markdownArtifactInputSchema,
  execute: async () => ({ created: true as const }),
})

export class AiSdkRuntime implements AiRuntime {
  constructor(
    private readonly resolveModel: (modelId: string) => LanguageModel =
      resolveChatModel
  ) {}

  async *execute(
    request: AiRuntimeRequest,
    options: { signal?: AbortSignal } = {}
  ): AsyncIterable<AiRuntimeEvent> {
    const lastUserText = request.prompt
      .findLast((message) => message.role === "user")
      ?.parts.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    const tools = { [MARKDOWN_ARTIFACT_TOOL_NAME]: markdownArtifactTool }
    const markdownArtifactEnabled = isExplicitMarkdownArtifactRequest(
      lastUserText ?? ""
    )
    const result = streamText({
      model: this.resolveModel(request.modelId),
      messages: await convertToModelMessages(request.prompt, { tools }),
      tools,
      activeTools: markdownArtifactEnabled
        ? [MARKDOWN_ARTIFACT_TOOL_NAME]
        : [],
      abortSignal: options.signal,
      stopWhen: isStepCount(5),
    })
    let text = ""

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text
        yield {
          type: "delta",
          partsDelta: [{ type: "text", text: part.text }],
        }
        continue
      }
      if (
        part.type === "tool-result" &&
        part.toolName === MARKDOWN_ARTIFACT_TOOL_NAME
      ) {
        const input = markdownArtifactInputSchema.parse(part.input)
        yield {
          type: "artifact",
          output: {
            kind: "markdown",
            title: input.title,
            content: input.content,
            toolCallId: part.toolCallId,
          },
        }
        continue
      }
      if (part.type === "abort") {
        yield { type: "stopped" }
        return
      }
      if (part.type === "error") {
        if (options.signal?.aborted) {
          yield { type: "stopped" }
          return
        }
        yield {
          type: "failed",
          error: {
            code: "ai_sdk_stream_error",
            message:
              part.error instanceof Error
                ? part.error.message
                : "AI SDK stream failed.",
          },
        }
        return
      }
    }

    yield {
      type: "completed",
      parts: text ? [{ type: "text", text }] : [],
    }
  }
}
