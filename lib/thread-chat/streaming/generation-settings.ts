import type { GenerationSettings } from "@/constants/generation-settings"
import { MAX_OUTPUT_TOKENS } from "@/constants/model"
import {
  reasoningForResearchRoute,
  type ResearchRouteMode,
} from "@/lib/chat/research-router"

export function chatAnswerGenerationOptions(
  researchMode: ResearchRouteMode,
  settings: GenerationSettings | undefined
) {
  if (!settings) {
    return {
      reasoning: reasoningForResearchRoute(researchMode),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    }
  }

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
