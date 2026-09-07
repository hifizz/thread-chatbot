import type { MessageContentPartInput } from "./message-content"

/** 未提交有序内容。localId 仅用于编辑器节点与附件上传身份，不进入网络。 */
export type ComposerMessagePartDraft = (MessageContentPartInput & { localId: string })
  | { type: "upload"; localId: string; filename: string; mediaType: string; error?: string }

export interface ThreadComposerDraft {
  parts: ComposerMessagePartDraft[]
}
