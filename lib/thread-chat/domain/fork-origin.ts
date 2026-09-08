import type { TextAnchor } from "./text-anchor"
import type { Fork } from "./types"

export interface ForkSelectionInput {
  anchorText?: string | null
  anchor?: TextAnchor | null
}

export type ForkOrigin =
  | { kind: "message"; anchorText: null; forkAnchor: null }
  | { kind: "selection"; anchorText: string; forkAnchor: TextAnchor }

/** API 边界：选区文本和锚点必须一起出现，且描述同一段原文。 */
export function isConsistentForkSelection(input: ForkSelectionInput): boolean {
  if (input.anchor == null) return input.anchorText == null
  return input.anchorText === input.anchor.quote.exact && input.anchorText.length > 0
}

/** 命令、持久化和即时展示共用的分叉来源模型；只在此处归一化空值。 */
export function resolveForkOrigin(input: ForkSelectionInput): ForkOrigin {
  if (!isConsistentForkSelection(input)) throw new Error("选区锚点与引用文本不一致")
  if (input.anchor && input.anchorText) {
    return { kind: "selection", anchorText: input.anchorText, forkAnchor: input.anchor }
  }
  return { kind: "message", anchorText: null, forkAnchor: null }
}

/** 已校验的 Thread 来源是否带选区；消息 Quote 的增删不改变这一来源事实。 */
export function hasSelectedForkText<T extends { anchorText?: string | null }>(source: T): source is T & { anchorText: string } {
  return typeof source.anchorText === "string" && source.anchorText.length > 0
}

/** 兼容视图将无选区文本投影为空串；有文本但缺锚点的旧划选仍不是整条消息分叉。 */
export function isMessageFork(fork: Pick<Fork, "text" | "anchor">): boolean {
  return !fork.anchor && !fork.text
}
