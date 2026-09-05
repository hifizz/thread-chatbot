"use client"

import {
  ATTACHMENT_POLICIES,
  ATTACHMENT_URL_PREFIX,
  TEXT_ATTACHMENT_FILE_EXTENSIONS,
  type AttachmentKind,
} from "@/constants/attachment"

export type AttachmentUploadStatus = "uploading" | "ready" | "error"

export interface UploadedAttachmentReference {
  url: string
  mediaType: string
  filename?: string
}

export interface AttachmentUploadResult {
  serverId: string
  reference: UploadedAttachmentReference
}

export interface AttachmentUploadOptions {
  onProgress?: (progress: number) => void
  fetch?: typeof globalThis.fetch
}

export interface AttachmentUploadValidation {
  kind: AttachmentKind
}

export function isTextAttachmentFile(
  file: Pick<File, "name" | "type">
): boolean {
  if (file.type === "text/plain") return true
  const filename = file.name?.toLowerCase()
  return Boolean(
    filename &&
      TEXT_ATTACHMENT_FILE_EXTENSIONS.some((extension) =>
        filename.endsWith(extension)
      )
  )
}

export function normalizeAttachmentFile(file: File): File {
  if (!isTextAttachmentFile(file) || file.type === "text/plain") return file
  return new File([file], file.name, {
    type: "text/plain",
    lastModified: file.lastModified,
  })
}

export function validateAttachmentFile(file: File): AttachmentUploadValidation {
  const normalizedFile = normalizeAttachmentFile(file)
  const policy = ATTACHMENT_POLICIES[normalizedFile.type]
  if (!policy) throw new Error(`不支持的文件类型：${file.type || "未知"}`)
  if (file.size > policy.maxBytes) {
    throw new Error(
      `文件超过大小上限（${Math.floor(policy.maxBytes / (1024 * 1024))}MB）`
    )
  }
  return { kind: policy.kind }
}

function putWithProgress(
  url: string,
  file: File,
  onProgress: (progress: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("Content-Type", file.type)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
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

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    error?: string
  } | null
  return body?.error ?? fallback
}

export async function uploadAttachment(
  file: File,
  options: AttachmentUploadOptions = {}
): Promise<AttachmentUploadResult> {
  const normalizedFile = normalizeAttachmentFile(file)
  validateAttachmentFile(normalizedFile)
  const request = options.fetch ?? globalThis.fetch
  const onProgress = options.onProgress ?? (() => {})
  const createResponse = await request("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: normalizedFile.name,
      contentType: normalizedFile.type,
      size: normalizedFile.size,
    }),
  })
  if (!createResponse.ok)
    throw new Error(await readError(createResponse, "创建附件失败"))
  const { id, uploadUrl } = (await createResponse.json()) as {
    id: string
    uploadUrl: string
  }

  await putWithProgress(uploadUrl, normalizedFile, (progress) =>
    onProgress(progress * 0.9)
  )
  onProgress(0.9)

  const ingestResponse = await request(`/api/attachments/${id}/ingest`, {
    method: "POST",
  })
  if (!ingestResponse.ok)
    throw new Error(await readError(ingestResponse, "附件处理失败"))
  onProgress(1)
  return {
    serverId: id,
    reference: {
      url: `${ATTACHMENT_URL_PREFIX}${id}`,
      mediaType: normalizedFile.type,
      ...(normalizedFile.name ? { filename: normalizedFile.name } : {}),
    },
  }
}

export async function deleteUploadedAttachment(serverId: string): Promise<void> {
  const response = await fetch(`/api/attachments/${serverId}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error(await readError(response, "移除附件失败"))
}
