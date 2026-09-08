import { tokenRouterModels } from "@/constants/models/token-router"
import { publicModelId } from "@/constants/models/types"

/** 旧 provider 的兼容目录；模型只在 token-router.ts 定义，旧服务待后续退役。 */
export const privateRelayModels = {
  id: "private-relay",
  name: "塞班岛",
  defaults: tokenRouterModels.defaults,
  models: tokenRouterModels.models.filter((model) => publicModelId(tokenRouterModels, model).startsWith("private-relay-")),
} as const
