import { resolveThreadChatModelId } from "@/constants/model"
import { emptySeedState } from "../../core/seed"
import type { ThreadTreeState } from "../../core/types"
import { sanitizeLoadedState, type LoadedTree } from "../persistence/persist"

export function threadChatBootSeed(
  loaded: Pick<LoadedTree, "state" | "generations">
): ThreadTreeState {
  return loaded.state
    ? sanitizeLoadedState(
        loaded.state,
        resolveThreadChatModelId,
        loaded.generations
      )
    : emptySeedState()
}

/** 网络已成功但服务端快照仍不可解析时，也必须完成 boot 并降级为空树。 */
export function threadChatBootSeedOrFallback(
  loaded: Pick<LoadedTree, "state" | "generations">,
  onInvalidState: (error: unknown) => void = (error) =>
    console.warn(
      "[thread-chat] 分支树快照无效，以空树降级启动（本次不恢复历史）：",
      error
    )
): ThreadTreeState {
  try {
    return threadChatBootSeed(loaded)
  } catch (error) {
    onInvalidState(error)
    return emptySeedState()
  }
}
