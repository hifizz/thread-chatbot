import { MODEL_CATALOG_REFRESH_MS, MODEL_CATALOG_RETRY_MS } from "@/constants/model-catalog"
import type { ModelCatalog } from "./schema"
import { requireCatalogModel } from "./lookup"

/** 仅模型目录使用的缓存。时钟、加载器与后台生命周期可独立验证。 */
export function createModelCatalogCache({ load, now = Date.now, onRefreshError = () => {} }: {
  load: () => Promise<ModelCatalog>
  now?: () => number
  onRefreshError?: (error: unknown) => void
}) {
  let snapshot: ModelCatalog | undefined
  let loadedAt = 0
  let retryAt = 0
  let pending: Promise<ModelCatalog> | undefined
  let scheduled = false

  function refresh() {
    if (pending) return pending
    pending = Promise.resolve().then(load).then((next) => {
      requireCatalogModel(next, next.defaultModelId)
      snapshot = next
      loadedAt = now()
      retryAt = 0
      return next
    }).catch((error: unknown) => {
      retryAt = now() + MODEL_CATALOG_RETRY_MS
      throw error
    }).finally(() => { pending = undefined })
    return pending
  }

  return {
    async get(schedule: (work: () => Promise<void>) => void): Promise<ModelCatalog> {
      if (!snapshot) return refresh()
      if (now() - loadedAt >= MODEL_CATALOG_REFRESH_MS && now() >= retryAt && !pending && !scheduled) {
        scheduled = true
        try {
          schedule(async () => {
            try { await refresh() } catch (error) { onRefreshError(error) }
            finally { scheduled = false }
          })
        } catch (error) {
          scheduled = false
          retryAt = now() + MODEL_CATALOG_RETRY_MS
          onRefreshError(error)
        }
      }
      return snapshot
    },
  }
}
