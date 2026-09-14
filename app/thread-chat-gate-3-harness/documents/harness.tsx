"use client"

import { useState } from "react"
import type { ArtifactDTO, ProjectDTO } from "@/lib/thread-chat/contracts/dto"
import type { DocumentRevisionDTO } from "@/lib/thread-chat/contracts/document"
import { createThreadChatClient } from "@/app/thread-chat/net/client"
import { ProjectPanel } from "@/app/thread-chat/orchestration/artifacts/project-panel"
import { DocumentView } from "@/app/thread-chat/orchestration/artifacts/documents/view"
import "@/app/thread-chat/thread-chat.css"

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const project: ProjectDTO = { id: id(1), rootThreadId: id(2), autoTitle: "金融 Agent 评测", customTitle: null,
  target: "横向评测 10 家金融 Agent", instructions: null, contractVersion: 0, archivedAt: null,
  createdAt: "2026-09-14T10:00:00Z", updatedAt: "2026-09-14T10:00:00Z" }
const revisions: DocumentRevisionDTO[] = [3, 2, 1].map((n) => ({
  id: id(10 + n), documentId: id(3), revisionNumber: n, parentRevisionId: n > 1 ? id(9 + n) : null,
  artifactId: id(20 + n), title: "F1 · 金融 Agent 评测计划", sourceThreadId: n === 1 ? id(2) : id(40 + n),
  sourceMessageId: id(30 + n), sourceMessageStatus: "completed",
  changeSummary: n === 1 ? "创建初始计划" : n === 2 ? "Thread A 更新 TODO6 方案并标记完成" : "Thread B 补充 TODO2 的评测维度",
  content: `# 金融 Agent 评测计划\n\n目标：横向评测 10 家金融 Agent。\n\n## TODO2：评测维度\n\n${n === 3 ? "准确性、完整性、时效性、引用质量、合规性、响应速度。" : "待调研确定。"}\n\n## TODO6：评分方案\n\n- [${n > 1 ? "x" : " "}] 确定评分方案\n\n${n > 1 ? "采用盲评与双人复核，每个平台完成 500 道题。" : "评分方案待讨论。"}`,
  createdAt: `2026-09-14T${10 + n}:00:00Z`,
}))
const artifacts: ArtifactDTO[] = revisions.map((r) => ({ id: r.artifactId, projectId: project.id,
  threadId: r.sourceThreadId, sourceMessageId: r.sourceMessageId, sourceThreadTitle: r.revisionNumber === 1 ? "主线" : `Thread ${r.revisionNumber === 2 ? "A" : "B"}`,
  sourceThreadFootnote: r.revisionNumber === 1 ? null : r.revisionNumber - 1, sourceMessageStatus: r.sourceMessageStatus,
  kind: "markdown", title: r.title, content: r.content, language: null, metadata: {}, createdAt: r.createdAt, updatedAt: r.createdAt,
  document: { id: r.documentId, revisionId: r.id, revisionNumber: r.revisionNumber, currentRevisionId: revisions[0].id },
}))
const client = createThreadChatClient({ fetch: async (input) => {
  const url = String(input)
  if (url.includes("/artifacts/")) return Response.json(artifacts.find((artifact) => url.endsWith(artifact.id)))
  return Response.json(revisions.map((revision) => {
    const summary = { ...revision, content: undefined }
    return summary
  }))
} })
const noop = async () => {}
export function DocumentsHarness() {
  const [activeId, setActiveId] = useState<string | null>(artifacts[0].id)
  return <main className="tc" style={{ minHeight: "100dvh" }}>
    <ProjectPanel project={project} files={[]} artifacts={artifacts} open activeId={activeId}
      onClose={() => {}} onSelect={setActiveId} onLocate={() => {}} onRefresh={noop}
      onSaveContract={noop} onAddProjectFile={noop} onRemoveProjectFile={noop}
      renderDocumentControls={(artifact) => <DocumentView navigationBlocked={false} artifact={artifact} client={client} onSelect={setActiveId} />} />
  </main>
}
