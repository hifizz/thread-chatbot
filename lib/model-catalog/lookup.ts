import type { ModelCatalog } from "./schema"
import { ModelCatalogError } from "./errors"

export function requireCatalogModel(catalog: ModelCatalog, id: string) {
  const model = catalog.models.find((entry) => entry.id === id && entry.enabled)
  if (!model) throw new ModelCatalogError("模型已停用或不存在，请刷新页面并重新选择模型", 400)
  return model
}
