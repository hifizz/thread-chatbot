"use client"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Download, Share2 } from "lucide-react"
import { useState } from "react"
import { DOCUMENT_UI_COPY } from "@/constants/project-documents"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { documentExportSnapshot } from "@/lib/thread-chat/domain/documents/export"

export function DocumentExportActions({ artifact }: { artifact: ArtifactDTO }) {
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const createFile = () => {
    const snapshot = documentExportSnapshot(artifact)
    return new File([snapshot.content], snapshot.filename, { type: snapshot.mimeType })
  }
  const download = () => {
    setError(null)
    try {
      const file = createFile()
      const url = URL.createObjectURL(file)
      try {
        const link = document.createElement("a")
        link.href = url
        link.download = file.name
        link.click()
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 0) }
    } catch { setError(DOCUMENT_UI_COPY.exportFailed) }
  }
  const share = async () => {
    setError(null)
    setSharing(true)
    try {
      const file = createFile()
      if (!navigator.canShare?.({ files: [file] })) {
        setError(DOCUMENT_UI_COPY.shareUnsupported)
        return
      }
      await navigator.share({ files: [file], title: artifact.title })
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(DOCUMENT_UI_COPY.shareFailed)
    } finally { setSharing(false) }
  }
  return <>
    {error && <p className="project-document-action-error" role="alert">{error}</p>}
    <DropdownMenuItem onClick={download} closeOnClick={false}><Download size={14} />导出当前版本</DropdownMenuItem>
    <DropdownMenuItem disabled={sharing} closeOnClick={false} onClick={() => void share()}><Share2 size={14} />分享当前版本文件</DropdownMenuItem>
  </>
}
