import { tokenRouterModels } from "@/constants/models/token-router"
import { expandProviderModels } from "@/constants/models/types"
import { DEFAULT_MODEL_ID } from "@/constants/models"
import { MODEL_CATALOG_SETTINGS_ID } from "@/constants/model-catalog"
import { db } from "@/lib/db"
import { modelCatalog, modelCatalogSettings } from "@/lib/db/schema"
import { modelCatalogConfigSchema } from "./schema"

/** 幂等导入，仅新增不存在的模型，不覆盖管理员编辑。 */
export async function seedModelCatalog() {
  const models = expandProviderModels(tokenRouterModels)
  await db.transaction(async (tx) => {
    for (const [sortOrder, model] of models.entries()) {
      const definition = tokenRouterModels.models[sortOrder]
      const capability = model.capabilities.generationSettings
      const upstreamId = definition.id
      const policy = "requestPolicy" in definition ? definition.requestPolicy : null
      const profile = upstreamId.startsWith("claude-") ? capability ? "anthropic-adaptive" : "anthropic"
        : upstreamId.startsWith("gpt-") ? "gpt"
        : policy?.thinking === "optional" ? "deepseek"
        : policy?.toolChoice === "auto" ? "glm"
        : policy ? "thinking-required" : "openai-chat"
      const efforts = capability?.effortLevels ?? (policy ? ["low", "high", "max"] as const : [])
      const outputs = capability?.maxOutputTokenOptions ?? [16_000]
      const config = modelCatalogConfigSchema.parse({
        name: model.name, description: model.description ?? "", upstreamId, logo: "auto", profile,
        // 原 contextLabel 是暂定展示值，不能自动当作经过验证的请求上限。
        contextWindow: null,
        imageInput: model.capabilities.imageInput === true, toolCalling: true,
        reasoning: model.capabilities.reasoning === true || efforts.length > 0,
        effortLevels: [...efforts], defaultEffort: efforts.includes("high") ? "high" : efforts[0] ?? null,
        maxOutputTokens: Math.max(...outputs), outputTokenOptions: [...outputs],
        defaultMaxOutputTokens: outputs.includes(32_000) ? 32_000 : outputs[0],
      })
      await tx.insert(modelCatalog).values({ id: model.id, enabled: true, sortOrder, config }).onConflictDoNothing()
    }
    await tx.insert(modelCatalogSettings).values({ id: MODEL_CATALOG_SETTINGS_ID, defaultModelId: DEFAULT_MODEL_ID }).onConflictDoNothing()
  })
}
