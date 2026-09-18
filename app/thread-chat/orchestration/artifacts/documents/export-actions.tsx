"use client"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Download, Share2 } from "lucide-react"
import { useState } from "react"
import { DOCUMENT_UI_KEYS } from "@/constants/project-documents"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { documentExportSnapshot } from "@/lib/thread-chat/domain/documents/export"
import { useI18n } from "@/lib/i18n/client"


export function DocumentExportActions({ artifact }: { artifact: ArtifactDTO }) {
  const { t } = useI18n()

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
    } catch { setError(t(DOCUMENT_UI_KEYS.exportFailed)) }
  }
  const share = async () => {
    setError(null)
    setSharing(true)
    try {
      const file = createFile()
      if (!navigator.canShare?.({ files: [file] })) {
        setError(t(DOCUMENT_UI_KEYS.shareUnsupported))
        return
      }
      await navigator.share({ files: [file], title: artifact.title })
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(t(DOCUMENT_UI_KEYS.shareFailed))
    } finally { setSharing(false) }
  }
  return <>
    {error && <p className="project-document-action-error" role="alert">{error}</p>}
    <DropdownMenuItem onClick={download} closeOnClick={false}><Download size={14} />{t("ui.exportThisVersion")}</DropdownMenuItem>
    <DropdownMenuItem disabled={sharing} closeOnClick={false} onClick={() => void share()}><Share2 size={14} />{t("ui.shareThisVersionAsAFile")}</DropdownMenuItem>
  </>
}
