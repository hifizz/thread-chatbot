"use client"

import { DOCUMENT_RESULT_KEYS } from "@/constants/project-documents"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { useArtifactNavigation } from "../composer/artifact-resources"
import { useI18n } from "@/lib/i18n/client"


type DocumentToolPart = Extract<ThreadChatUIMessage["parts"][number], {
  type: "tool-findProjectDocuments" | "tool-readProjectDocument" | "tool-updateProjectDocument"
}>
export function DocumentUpdateTool({ part }: { part: DocumentToolPart }) {
  const { t } = useI18n()

  const open = useArtifactNavigation()
  if (part.state === "output-error") return <p role="status">{t("ui.documentOperationFailed")}</p>
  if (part.state !== "output-available") return <p role="status">{part.type === "tool-updateProjectDocument" ? t("ui.savingDocumentChanges") : t("ui.readingProjectDocuments")}</p>
  if (part.type === "tool-findProjectDocuments") return <p>{t("common.foundDocuments", { count: part.output.length })}</p>
  if (part.type === "tool-readProjectDocument") return <p>{t("common.readDocument", { title: part.output.revision.title, version: part.output.revision.revisionNumber })}</p>
  const result = part.output
  return <div className="project-resource-card" role="status">
    {result.status === "committed" ? <div>
      <strong>{t("ui.documentChangesSaved")}</strong><p>{result.changeSummary}</p>
      <button type="button" className="project-secondary" disabled={!open} onClick={() => open?.(result.artifactId)}>{t("ui.viewThisVersionAndItsChanges")}</button>
    </div> : result.status === "unchanged" ? <p>{t("ui.theContentAlreadyMeetsTheRequest")}</p>
      : result.status === "conflict" ? <p>{t("ui.aNewerVersionExistsTheseChanges")}</p>
        : <p>{t(DOCUMENT_RESULT_KEYS[result.code])}</p>}
  </div>
}
