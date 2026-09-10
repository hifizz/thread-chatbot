import { MODELS, DEFAULT_MODEL_ID } from "@/constants/models"
import type { ModelCatalog } from "@/lib/model-catalog/schema"

/** 离线领域测试显式传入的目录；不参与产品运行时加载。 */
export const fixtureModelCatalog: ModelCatalog = {
  defaultModelId: DEFAULT_MODEL_ID,
  version: 1,
  models: MODELS.map((model, sortOrder) => {
    const settings = model.capabilities.generationSettings
    const efforts = settings?.effortLevels ?? []
    const outputs = settings?.maxOutputTokenOptions ?? [16_000]
    return { id: model.id, enabled: true, version: 1, sortOrder, config: {
      name: model.name, description: "", upstreamId: model.id, profile: "openai-chat", logo: "auto", contextWindow: null,
      imageInput: model.capabilities.imageInput === true, reasoning: model.capabilities.reasoning === true, toolCalling: true,
      effortLevels: [...efforts], defaultEffort: efforts.includes("high") ? "high" : efforts[0] ?? null,
      maxOutputTokens: Math.max(...outputs), outputTokenOptions: [...outputs], defaultMaxOutputTokens: outputs.includes(32_000) ? 32_000 : outputs[0],
    } }
  }),
}
