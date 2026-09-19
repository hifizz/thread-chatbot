"use client"

import { DOCUMENT_RESULT_COPY } from "@/constants/project-documents"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { useArtifactNavigation } from "../composer/artifact-resources"

type DocumentToolPart = Extract<ThreadChatUIMessage["parts"][number], {
  type: `tool-${"findProjectDocuments" | "readProjectDocument" | "editProjectDocument" | "commitProjectDocument" | "resetProjectDocumentDraft" | "updateProjectDocument"}`
}>

const inProgressCopy: Partial<Record<DocumentToolPart["type"], string>> = {
  "tool-editProjectDocument": "正在修改文档草稿…",
  "tool-commitProjectDocument": "正在提交文档修改…",
  "tool-resetProjectDocumentDraft": "正在按最新正式版本重建草稿…",
  "tool-updateProjectDocument": "正在提交文档修改…",
}

export function DocumentUpdateTool({ part }: { part: DocumentToolPart }) {
  const open = useArtifactNavigation()
  if (part.state === "output-error") return <p role="status">文档操作失败：{part.errorText}</p>
  if (part.state !== "output-available")
    return <p role="status">{inProgressCopy[part.type] ?? "正在读取项目文档…"}</p>
  if (part.type === "tool-findProjectDocuments") return <p>找到 {part.output.length} 份候选文档</p>
  if (part.type === "tool-readProjectDocument") {
    if ("draft" in part.output)
      return <p role="status">已读取「{part.output.document.title}」工作副本（草稿 #{part.output.draft.sequence}）</p>
    if ("revision" in part.output)
      return <p>已读取「{part.output.revision.title}」V{part.output.revision.revisionNumber}</p>
    return <p role="status">{part.output.message}</p>
  }
  const result = part.output
  if (result.status === "error") return <p role="status">{result.message}</p>
  if (part.type === "tool-editProjectDocument") {
    return <div className="project-resource-card" role="status">
      {result.status === "edited" ? <p>草稿已更新（检查点 #{result.sequence}），尚未发布正式版本。</p>
        : result.status === "no_change" ? <p>草稿内容无变化。</p>
          : <p>{DOCUMENT_RESULT_COPY[result.code] ?? "本次修改未保存。"}</p>}
    </div>
  }
  if (part.type === "tool-resetProjectDocumentDraft") {
    return <div className="project-resource-card" role="status">
      {result.status === "reset" ? <p>已按最新正式版本重建草稿（检查点 #{result.sequence}）。</p>
        : result.status === "conflict" ? <p>重置目标已过期，需要重新读取正式版本。</p>
          : <p>{DOCUMENT_RESULT_COPY[result.code] ?? "草稿重置未完成。"}</p>}
    </div>
  }
  return <div className="project-resource-card" role="status">
    {result.status === "committed" ? <div>
      <strong>文档修改已保存</strong><p>{result.changeSummary}</p>
      <button type="button" className="project-secondary" disabled={!open} onClick={() => open?.(result.artifactId)}>查看本次版本与差异</button>
    </div> : result.status === "unchanged" ? <p>内容已满足要求，未产生新版本。</p>
      : result.status === "conflict" ? <p>文档已有新版本，本次未保存，需要重新读取后处理。</p>
        : <p>{DOCUMENT_RESULT_COPY[result.code] ?? "本次修改未保存。"}</p>}
  </div>
}
