import { isThreadChatModelId } from "@/constants/model"
import { HISTORICAL_MODEL_ALIASES } from "@/constants/models/historical-aliases"

/** 只解析新分支的模型；不修改历史记录，也不回退到默认模型。 */
export function resolveForkModelId(modelId: string | null | undefined): string | null {
  if (isThreadChatModelId(modelId)) return modelId
  if (!modelId || !Object.hasOwn(HISTORICAL_MODEL_ALIASES, modelId)) return null
  const target = HISTORICAL_MODEL_ALIASES[modelId]
  return isThreadChatModelId(target) ? target : null
}
