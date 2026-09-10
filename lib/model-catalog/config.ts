import { after } from "next/server"
import { createModelCatalogCache } from "./cache"
import { ModelCatalogError } from "./errors"
import { readModelCatalog } from "./repository"

declare global {
  var __modelCatalogCache: ReturnType<typeof createModelCatalogCache> | undefined
}

// 页面与接口可能来自不同模块包，必须共享服务实例上的同一份缓存。
const catalogCache = globalThis.__modelCatalogCache ??= createModelCatalogCache({
  load: readModelCatalog,
  onRefreshError: () => console.warn("[model-catalog] 刷新失败，保留旧配置并稍后重试"),
})

/** 只在服务端请求/任务入口调用；after 托管响应结束后的刷新。 */
export async function getModelConfig() {
  try { return await catalogCache.get(after) }
  catch { throw new ModelCatalogError("模型目录暂不可用，请稍后重试或联系管理员", 503) }
}
