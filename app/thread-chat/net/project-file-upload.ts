"use client"

import { ATTACHMENT_POLICIES } from "@/constants/attachment"

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null
  return body?.error ?? fallback
}

export interface ProjectFileUploadCallbacks {
  onAttachmentCreated?(attachmentId: string): Promise<void> | void
}

/**
 * Reuse the existing Attachment + R2 + ingest pipeline for Project Files.
 * Membership is established as soon as the Attachment row exists, so the
 * Project workspace can truthfully expose the uploading lifecycle.
 */
export async function uploadProjectFile(
  file: File,
  callbacks: ProjectFileUploadCallbacks = {}
): Promise<string> {
  const policy = ATTACHMENT_POLICIES[file.type]
  if (!policy) throw new Error(`不支持的文件类型：${file.type || "未知"}`)
  if (file.size > policy.maxBytes) {
    throw new Error(
      `文件超过大小上限（${Math.floor(policy.maxBytes / (1024 * 1024))}MB）`
    )
  }

  const createResponse = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  })
  if (!createResponse.ok) {
    throw new Error(await readError(createResponse, "创建附件失败"))
  }

  const { id, uploadUrl } = (await createResponse.json()) as {
    id: string
    uploadUrl: string
  }

  await callbacks.onAttachmentCreated?.(id)

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  })
  if (!uploadResponse.ok) {
    throw new Error(`上传失败（HTTP ${uploadResponse.status}）`)
  }

  const ingestResponse = await fetch(`/api/attachments/${id}/ingest`, {
    method: "POST",
  })
  if (!ingestResponse.ok) {
    throw new Error(await readError(ingestResponse, "附件处理失败"))
  }

  return id
}
