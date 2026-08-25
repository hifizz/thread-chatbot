import {
  wrapEmbeddingModel,
  wrapLanguageModel,
  type EmbeddingModel,
  type EmbeddingModelMiddleware,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai"
import type { ModelCallPurpose } from "@/constants/model-call"

export type ModelCallTrace = {
  requestId?: string
  projectId?: string
  threadId?: string
  generationId?: string
  assistantMessageId?: string
}

type PromptSummary = {
  messageCount: number
  roleCounts: Record<string, number>
  textCharacters: number
  filePartCount: number
  toolCallPartCount: number
  toolResultPartCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function summarizePrompt(prompt: readonly unknown[]): PromptSummary {
  const summary: PromptSummary = {
    messageCount: prompt.length,
    roleCounts: {},
    textCharacters: 0,
    filePartCount: 0,
    toolCallPartCount: 0,
    toolResultPartCount: 0,
  }

  for (const message of prompt) {
    if (!isRecord(message)) continue
    const role = typeof message.role === "string" ? message.role : "unknown"
    summary.roleCounts[role] = (summary.roleCounts[role] ?? 0) + 1

    const content = message.content
    if (typeof content === "string") {
      summary.textCharacters += content.length
      continue
    }
    if (!Array.isArray(content)) continue

    for (const part of content) {
      if (!isRecord(part)) continue
      if (typeof part.text === "string")
        summary.textCharacters += part.text.length
      if (part.type === "file") summary.filePartCount += 1
      if (part.type === "tool-call") summary.toolCallPartCount += 1
      if (part.type === "tool-result") summary.toolResultPartCount += 1
    }
  }

  return summary
}

function writeModelCallLog(input: {
  operation: "generate" | "stream" | "embed"
  purpose: ModelCallPurpose
  provider: string
  model: string
  trace?: ModelCallTrace
  context: Record<string, unknown>
}) {
  console.info(
    "[model-call]",
    JSON.stringify({
      callId: crypto.randomUUID(),
      operation: input.operation,
      purpose: input.purpose,
      provider: input.provider,
      model: input.model,
      ...input.trace,
      context: input.context,
    })
  )
}

/** 在每次真正进入 LanguageModel 的 generate/stream 方法前记录一条脱敏摘要。 */
export function withModelCallLogging(
  model: LanguageModel,
  purpose: ModelCallPurpose,
  trace?: ModelCallTrace
): LanguageModel {
  // AI SDK 也允许传入网关字符串引用；它没有可包装的模型方法，只能原样交还。
  if (typeof model === "string") return model

  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, model: resolvedModel, params }) => {
      writeModelCallLog({
        operation: "generate",
        purpose,
        provider: resolvedModel.provider,
        model: resolvedModel.modelId,
        trace,
        context: {
          ...summarizePrompt(params.prompt),
          availableToolCount: params.tools?.length ?? 0,
          maxOutputTokens: params.maxOutputTokens,
        },
      })
      return doGenerate()
    },
    wrapStream: async ({ doStream, model: resolvedModel, params }) => {
      writeModelCallLog({
        operation: "stream",
        purpose,
        provider: resolvedModel.provider,
        model: resolvedModel.modelId,
        trace,
        context: {
          ...summarizePrompt(params.prompt),
          availableToolCount: params.tools?.length ?? 0,
          maxOutputTokens: params.maxOutputTokens,
        },
      })
      return doStream()
    },
  }

  return wrapLanguageModel({ model, middleware })
}

/** 在每次真正进入 EmbeddingModel 前记录条数与字符数，不记录原文。 */
export function withEmbeddingCallLogging(
  model: EmbeddingModel,
  purpose: ModelCallPurpose,
  trace?: ModelCallTrace
): EmbeddingModel {
  // 与 LanguageModel 相同，字符串引用由 AI SDK 自己解析，无法在这里包裹方法。
  if (typeof model === "string" || model.specificationVersion === "v2")
    return model

  const middleware: EmbeddingModelMiddleware = {
    wrapEmbed: async ({ doEmbed, model: resolvedModel, params }) => {
      writeModelCallLog({
        operation: "embed",
        purpose,
        provider: resolvedModel.provider,
        model: resolvedModel.modelId,
        trace,
        context: {
          valueCount: params.values.length,
          textCharacters: params.values.reduce(
            (total, value) => total + value.length,
            0
          ),
        },
      })
      return doEmbed()
    },
  }

  return wrapEmbeddingModel({ model, middleware })
}
