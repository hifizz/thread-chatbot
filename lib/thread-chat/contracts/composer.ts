import type { FileReference } from "@/lib/thread-chat/contracts/message-content"
import type { ComposerQuoteSourceDraft } from "@/lib/thread-chat/contracts/quote"

export interface ComposerQuoteDraft {
  text: string
  comment: string
  source: ComposerQuoteSourceDraft
  origin: "selection" | "fork-prefill" | "message-edit"
  readonlySnapshot: boolean
}

export type ComposerMessagePartDraft =
  | { localId: string; type: "text"; text: string }
  | { localId: string; type: "file"; file: FileReference }
  | { localId: string; type: "quote"; quote: ComposerQuoteDraft }

/**
 * 尚未发送的有序 Composer 草稿。localId、origin 和 readonlySnapshot 仅服务 UI，
 * 删除或排序只修改 parts；Quote 的 text/source/anchor 始终视为只读快照。
 */
export interface ThreadComposerDraft {
  parts: ComposerMessagePartDraft[]
}
