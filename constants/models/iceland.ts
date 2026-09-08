import { tokenRouterModels } from "@/constants/models/token-router"
import { publicModelId } from "@/constants/models/types"

/** 旧 provider 的兼容目录；模型只在 token-router.ts 定义，旧服务待后续退役。 */
export const icelandModels = {
  id: "iceland-relay",
  name: "冰岛",
  defaults: tokenRouterModels.defaults,
  models: tokenRouterModels.models.filter((model) => publicModelId(tokenRouterModels, model).startsWith("iceland-")),
} as const
