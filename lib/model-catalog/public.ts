import type { ClientModelOption } from "@/constants/models"
import type { CatalogModel, ModelCatalog } from "./schema"

/** 浏览器只接收展示和能力；上游 ID、请求适配、审计数据留在服务端。 */
export type PublicCatalogModel = ClientModelOption & {
  logo: CatalogModel["config"]["logo"]
  contextWindow: number | null
}
export type PublicModelCatalog = { models: PublicCatalogModel[]; defaultModelId: string }
export function toPublicCatalogModel(model: CatalogModel): PublicCatalogModel {
  const c = model.config
  return {
    id: model.id, name: c.name, description: c.description,
    groupId: "token-router", groupName: "Token Router", logo: c.logo,
    contextWindow: c.contextWindow,
    contextLabel: c.contextWindow === null ? "Unknown ctx" : `${(c.contextWindow / 1000).toLocaleString()}K ctx`,
    capabilities: {
      imageInput: c.imageInput, reasoning: c.reasoning, toolCalling: c.toolCalling,
      generationSettings: {
        effortLevels: c.effortLevels,
        maxOutputTokenOptions: c.outputTokenOptions,
        defaults: { ...(c.defaultEffort ? { effort: c.defaultEffort } : {}), maxOutputTokens: c.defaultMaxOutputTokens },
      },
    },
  }
}

export function toPublicModelCatalog(catalog: ModelCatalog): PublicModelCatalog {
  return { models: catalog.models.filter((model) => model.enabled).map(toPublicCatalogModel), defaultModelId: catalog.defaultModelId }
}
