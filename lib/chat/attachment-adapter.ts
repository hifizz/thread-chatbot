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

// 覆盖 react-ai-sdk 默认的 vercelAttachmentAdapter（base64 内联进消息 → 撑爆 Postgres jsonb）。
// 策略：选中文件即上传 R2 + 服务端解析（与用户打字并行），点发送时零等待。

type UploadResult = { serverId: string }

/** attachment.id → 上传管线的 promise；send() 从这里取结果，remove() 用它找服务端 id */
const uploads = new Map<string, Promise<UploadResult>>()

/**
 * 由 composer 附件的客户端 id 解析出服务端附件 id（用于发送前拉取洞察等）。
 * 上传未完成/失败时返回 undefined。
 */
export async function resolveServerId(clientAttachmentId: string): Promise<string | undefined> {
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

function putWithProgress(
  url: string,
  file: File,
  onProgress: (progress: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    // Content-Type 参与了 presign 签名，必须与服务端签发时完全一致
    xhr.setRequestHeader("Content-Type", file.type)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`上传失败（HTTP ${xhr.status}）`))
    xhr.onerror = () =>
      reject(new Error("上传失败（网络错误，或 R2 桶未配置 CORS）"))
    xhr.send(file)
  })
}

async function readError(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? fallback
}

async function uploadAndIngest(
  file: File,
  onProgress: (progress: number) => void
): Promise<UploadResult> {
  const createRes = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  })
  if (!createRes.ok) throw new Error(await readError(createRes, "创建附件失败"))
  const { id, uploadUrl } = (await createRes.json()) as {
    id: string
    uploadUrl: string
  }

  // 直传阶段占进度条 0~90%，剩余留给服务端解析
  await putWithProgress(uploadUrl, file, (p) => onProgress(p * 0.9))
  onProgress(0.9)

  const ingestRes = await fetch(`/api/attachments/${id}/ingest`, {
    method: "POST",
  })
  if (!ingestRes.ok) throw new Error(await readError(ingestRes, "附件处理失败"))
  onProgress(1)
  return { serverId: id }
}

export const r2AttachmentAdapter: AttachmentAdapter = {
  accept: ATTACHMENT_ACCEPT,

  async *add({ file }): AsyncGenerator<PendingAttachment, void> {
    const policy = ATTACHMENT_POLICIES[file.type]
    const id = crypto.randomUUID()
    const base = {
      id,
      type: policy ? KIND_TO_ATTACHMENT_TYPE[policy.kind] : ("file" as const),
      name: file.name,
      contentType: file.type,
      file,
    }

    const fail = (message: string): PendingAttachment => {
      toast.error(message)
      return { ...base, status: { type: "incomplete", reason: "error" } }
    }

    if (!policy) {
      yield fail(`不支持的文件类型：${file.type || "未知"}`)
      return
    }
    if (file.size > policy.maxBytes) {
      yield fail(
        `文件超过大小上限（${Math.floor(policy.maxBytes / (1024 * 1024))}MB）`
      )
      return
    }

    const channel = createProgressChannel()
    const upload = uploadAndIngest(file, channel.push).finally(channel.close)
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
      await fetch(`/api/attachments/${serverId}`, { method: "DELETE" }).catch(
        () => {}
      )
    }
  },
}
