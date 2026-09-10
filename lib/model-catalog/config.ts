import { ModelCatalogError } from "./errors"
import { after } from "next/server"
import { createModelCatalogCache } from "./cache"
import { readModelCatalog } from "./repository"

const catalogCache = createModelCatalogCache({
  load: readModelCatalog,
  onRefreshError: () => console.warn("[model-catalog] 刷新失败，保留旧配置并稍后重试"),
})

/** 只在服务端请求/任务入口调用；after 托管响应结束后的刷新。 */
export async function getModelConfig() {
  try { return await catalogCache.get(after) }
  catch { throw new ModelCatalogError("模型目录暂不可用，请稍后重试或联系管理员", 503) }
}
