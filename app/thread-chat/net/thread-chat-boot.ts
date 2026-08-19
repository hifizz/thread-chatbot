import { resolveThreadChatModelId } from "@/constants/model"
import { emptySeedState } from "../core/seed"
import type { ThreadTreeState } from "../core/types"
import { sanitizeLoadedState, type LoadedTree } from "./persist"

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
