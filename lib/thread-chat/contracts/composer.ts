import type { MessageContentPartInput } from "./message-content"

/** 正文只保存可提交内容；上传生命周期由独立附件队列持有。 */
export type ComposerMessagePartDraft = MessageContentPartInput & { localId: string }

export interface ThreadComposerDraft {
  parts: ComposerMessagePartDraft[]
}
