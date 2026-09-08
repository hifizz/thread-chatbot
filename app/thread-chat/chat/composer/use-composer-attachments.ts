"use client"

import { useStore } from "zustand"
import { toast } from "sonner"
import { COMPOSER_ATTACHMENT_COPY, IMAGE_ATTACHMENT_LIMITS, IMAGE_MODEL_VALIDATION_MESSAGE, MESSAGE_ATTACHMENT_MAX_FILES } from "@/constants/attachment"
import { supportsModelImageInput } from "@/constants/model"
import { deleteUploadedAttachment, uploadAttachment, validateAttachmentFile } from "@/lib/attachments/upload"
import { preprocessImageAttachment } from "@/lib/attachments/image"
import type { ComposerAttachmentDraft } from "@/lib/thread-chat/composer-attachments"
import { useComposerDraftStore } from "./composer-drafts"
import { isThreadComposerFile, isThreadComposerImageFile } from "./thread-attachment-model"

const EMPTY_ATTACHMENTS: ComposerAttachmentDraft[] = []

export function useComposerAttachments(scope: string, modelId?: string) {
  const store = useComposerDraftStore()
  const items = useStore(store, (state) => state.attachments?.[scope] ?? EMPTY_ATTACHMENTS)
  const current = () => store.getState().attachments?.[scope] ?? EMPTY_ATTACHMENTS
  const change = (apply: (items: ComposerAttachmentDraft[]) => ComposerAttachmentDraft[]) => {
    store.setState((state) => ({ attachments: { ...state.attachments, [scope]: apply(state.attachments?.[scope] ?? EMPTY_ATTACHMENTS) } }))
  }
  const replace = (item: ComposerAttachmentDraft) => change((all) => all.map((previous) => previous.id === item.id ? item : previous))

  async function upload(id: string, source: File) {
    let file = source
    try {
      file = await preprocessImageAttachment(source)
      if (!current().some((item) => item.id === id)) return
      replace({ id, file, status: "uploading", progress: 0 })
      const uploaded = await uploadAttachment(file, {
        onProgress: (progress) => replace({ id, file, status: "uploading", progress }),
      })
      if (current().some((item) => item.id === id)) replace({ id, file, status: "ready", uploaded })
      else await deleteUploadedAttachment(uploaded.serverId)
    } catch (error) {
      replace({ id, file, status: "error", error: error instanceof Error ? error.message : COMPOSER_ATTACHMENT_COPY.uploadFailed })
    }
  }

  function add(files: Iterable<File>) {
    for (const file of files) {
      try {
        if (!isThreadComposerFile(file)) throw new Error(COMPOSER_ATTACHMENT_COPY.unsupported)
        if (!file.size) throw new Error(COMPOSER_ATTACHMENT_COPY.empty)
        validateAttachmentFile(file)
        if (current().length >= MESSAGE_ATTACHMENT_MAX_FILES) throw new Error(`附件不能超过 ${MESSAGE_ATTACHMENT_MAX_FILES} 个`)
        if (isThreadComposerImageFile(file)) {
          if (!supportsModelImageInput(modelId)) throw new Error(IMAGE_MODEL_VALIDATION_MESSAGE)
          if (current().filter((item) => isThreadComposerImageFile(item.file)).length >= IMAGE_ATTACHMENT_LIMITS.maxFilesPerMessage) {
            throw new Error(`单次最多添加 ${IMAGE_ATTACHMENT_LIMITS.maxFilesPerMessage} 张图片`)
          }
        }
        const id = crypto.randomUUID()
        change((all) => [...all, { id, file, status: "uploading", progress: 0 }])
        void upload(id, file)
      } catch (error) { toast.error(error instanceof Error ? `${file.name}：${error.message}` : COMPOSER_ATTACHMENT_COPY.addFailed) }
    }
  }
  function remove(id: string) {
    const item = current().find((item) => item.id === id)
    change((all) => all.filter((item) => item.id !== id))
    if (item?.status === "ready") void deleteUploadedAttachment(item.uploaded.serverId).catch(() => toast.error(COMPOSER_ATTACHMENT_COPY.cleanupFailed))
  }
  function retry(id: string) {
    const item = current().find((item) => item.id === id)
    if (item?.status !== "error") return
    replace({ id, file: item.file, status: "uploading", progress: 0 })
    void upload(id, item.file)
  }
  function clearSubmitted(submitted: readonly ComposerAttachmentDraft[]) {
    const ids = new Set(submitted.map((item) => item.id))
    change((all) => all.filter((item) => !ids.has(item.id)))
  }
  return { items, current, add, remove, retry, clearSubmitted }
}
