"use client"

import type {
  Attachment,
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from "@assistant-ui/react"
import { toast } from "sonner"
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_POLICIES,
  ATTACHMENT_URL_PREFIX,
  type AttachmentKind,
} from "@/constants/attachment"
import {
  deleteUploadedAttachment,
  normalizeAttachmentFile,
  uploadAttachment,
  validateAttachmentFile,
} from "@/lib/attachments/upload"

// 覆盖 react-ai-sdk 默认的 vercelAttachmentAdapter（base64 内联进消息 → 撑爆 Postgres jsonb）。
// 策略：选中文件即上传 R2 + 服务端解析（与用户打字并行），点发送时零等待。

type UploadResult = { serverId: string }

/** attachment.id → 上传管线的 promise；send() 从这里取结果，remove() 用它找服务端 id */
const uploads = new Map<string, Promise<UploadResult>>()

/**
 * 由 composer 附件的客户端 id 解析出服务端附件 id（用于发送前拉取洞察等）。
 * 上传未完成/失败时返回 undefined。
 */
export async function resolveServerId(
  clientAttachmentId: string
): Promise<string | undefined> {
  const upload = uploads.get(clientAttachmentId)
  if (!upload) return undefined
  try {
    return (await upload).serverId
  } catch {
    return undefined
  }
}

const KIND_TO_ATTACHMENT_TYPE: Record<AttachmentKind, Attachment["type"]> = {
  document: "document",
  image: "image",
  archive: "file",
  video: "file",
}

function attachmentKindOrNull(file: File): AttachmentKind | null {
  return ATTACHMENT_POLICIES[file.type]?.kind ?? null
}

/** 单消费者异步通道：把 XHR 的 progress 回调转成 add() 里可 for-await 的进度流 */
function createProgressChannel() {
  const queue: number[] = []
  let wake: (() => void) | null = null
  let closed = false
  return {
    push(value: number) {
      queue.push(value)
      wake?.()
    },
    close() {
      closed = true
      wake?.()
    },
    async *iterate() {
      while (true) {
        while (queue.length > 0) yield queue.shift()!
        if (closed) return
        await new Promise<void>((resolve) => (wake = resolve))
        wake = null
      }
    },
  }
}


export const r2AttachmentAdapter: AttachmentAdapter = {
  accept: ATTACHMENT_ACCEPT,

  async *add({ file }): AsyncGenerator<PendingAttachment, void> {
    const normalizedFile = normalizeAttachmentFile(file)
    const id = crypto.randomUUID()
    const kind = attachmentKindOrNull(normalizedFile)
    const base = {
      id,
      type: kind ? KIND_TO_ATTACHMENT_TYPE[kind] : ("file" as const),
      name: normalizedFile.name,
      contentType: normalizedFile.type,
      file: normalizedFile,
    }
    const fail = (message: string): PendingAttachment => {
      toast.error(message)
      return { ...base, status: { type: "incomplete", reason: "error" } }
    }
    try {
      validateAttachmentFile(normalizedFile)
    } catch (error) {
      yield fail(error instanceof Error ? error.message : "附件校验失败")
      return
    }

    const channel = createProgressChannel()
    const upload = uploadAttachment(normalizedFile, { onProgress: channel.push })
      .then(({ serverId }) => ({ serverId }))
      .finally(channel.close)
    uploads.set(id, upload)
    // send() 之前无人 await 时，避免上传失败变成 unhandled rejection
    upload.catch(() => {})

    yield {
      ...base,
      status: { type: "running", reason: "uploading", progress: 0 },
    }
    for await (const progress of channel.iterate()) {
      yield {
        ...base,
        status: { type: "running", reason: "uploading", progress },
      }
    }

    try {
      await upload
    } catch (err) {
      uploads.delete(id)
      yield fail(err instanceof Error ? err.message : "附件上传失败")
      return
    }
    yield {
      ...base,
      status: { type: "requires-action", reason: "composer-send" },
    }
  },

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const upload = uploads.get(attachment.id)
    if (!upload)
      throw new Error(`附件「${attachment.name}」未完成上传，请移除后重试`)
    const { serverId } = await upload
    uploads.delete(attachment.id)

    return {
      ...attachment,
      status: { type: "complete" },
      // data 存应用内稳定 URL（presigned URL 会过期，不能落进持久化消息）；
      // 服务端 chat route 依据此 URL 前缀识别附件并决定注入策略
      content: [
        {
          type: "file",
          data: `${ATTACHMENT_URL_PREFIX}${serverId}`,
          mimeType: attachment.contentType ?? "application/octet-stream",
          filename: attachment.name,
        },
      ],
    }
  },

  async remove(attachment: Attachment): Promise<void> {
    const upload = uploads.get(attachment.id)
    uploads.delete(attachment.id)
    const serverId = await upload
      ?.then((r) => r.serverId)
      .catch(() => undefined)
    if (serverId) {
      await deleteUploadedAttachment(serverId).catch(() => {})
    }
  },
}
