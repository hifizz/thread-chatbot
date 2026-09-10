import type { streamText } from "ai"
import type { GenerationSettings } from "@/constants/generation-settings"
import { MAX_OUTPUT_TOKENS } from "@/constants/model"
import type { ModelRouteIdentity } from "@/lib/ai/llm/create-models"
import {
  reasoningForResearchRoute,
  type ResearchRouteMode,
} from "@/lib/chat/research-router"

export function chatAnswerGenerationOptions(
  researchMode: ResearchRouteMode,
  settings: GenerationSettings | undefined,
  protocol: ModelRouteIdentity["protocol"]
): Pick<Parameters<typeof streamText>[0], "reasoning" | "maxOutputTokens" | "providerOptions"> {
  if (!settings) {
    return {
      reasoning: reasoningForResearchRoute(researchMode),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    }
  }

  if (!settings.effort) return { maxOutputTokens: settings.maxOutputTokens }

  if (protocol === "openai-compatible") {
    return {
      maxOutputTokens: settings.maxOutputTokens,
      providerOptions: {
        openaiCompatible: { reasoningEffort: settings.effort },
      },
    }
  }
  if (protocol !== "anthropic") throw new Error("当前协议不支持自定义生成参数")

  return {
    maxOutputTokens: settings.maxOutputTokens,
    providerOptions: {
      anthropic: {
        effort: settings.effort,
        thinking: {
          type: "adaptive" as const,
          display: "summarized" as const,
        },
      },
    },
  }
}
