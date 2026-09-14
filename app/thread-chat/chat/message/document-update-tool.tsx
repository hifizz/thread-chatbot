"use client"

import { DOCUMENT_RESULT_COPY } from "@/constants/project-documents"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { useArtifactNavigation } from "../composer/artifact-resources"

type DocumentToolPart = Extract<ThreadChatUIMessage["parts"][number], {
  type: "tool-findProjectDocuments" | "tool-readProjectDocument" | "tool-updateProjectDocument"
}>
export function DocumentUpdateTool({ part }: { part: DocumentToolPart }) {
  const open = useArtifactNavigation()
  if (part.state === "output-error") return <p role="status">文档操作失败：{part.errorText}</p>
  if (part.state !== "output-available") return <p role="status">{part.type === "tool-updateProjectDocument" ? "正在提交文档修改…" : "正在读取项目文档…"}</p>
  if (part.type === "tool-findProjectDocuments") return <p>找到 {part.output.length} 份候选文档</p>
  if (part.type === "tool-readProjectDocument") return <p>已读取「{part.output.revision.title}」V{part.output.revision.revisionNumber}</p>
  const result = part.output
  return <div className="project-resource-card" role="status">
    {result.status === "committed" ? <div>
      <strong>文档修改已保存</strong><p>{result.changeSummary}</p>
      <button type="button" className="project-secondary" disabled={!open} onClick={() => open?.(result.artifactId)}>查看本次版本与差异</button>
    </div> : result.status === "unchanged" ? <p>内容已满足要求，无需修改。</p>
      : result.status === "conflict" ? <p>文档已有新版本，本次未保存，需要重新读取后处理。</p>
        : <p>{DOCUMENT_RESULT_COPY[result.code] ?? "本次修改未保存。"}</p>}
  </div>
}
