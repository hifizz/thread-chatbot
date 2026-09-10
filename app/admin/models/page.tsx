import { requireAdmin } from "@/lib/admin/auth"
import { readModelCatalog } from "@/lib/model-catalog/repository"
import { ModelCatalogManager } from "@/components/admin/models/model-catalog-manager"
export default async function ModelsPage() {
  await requireAdmin()
  const catalog = await readModelCatalog()
  return <ModelCatalogManager initial={{ models: catalog.models.map(({ id, enabled, sortOrder, version, config }) => ({ id, enabled, sortOrder, version, config })), defaultModelId: catalog.defaultModelId, version: catalog.version }} />
}
