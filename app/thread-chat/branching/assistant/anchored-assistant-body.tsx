"use client"

import type { MarkdownDensity } from "../../chat/message/markdown-body"
import type {
  ConversationViewMessage,
  ThreadTreeState,
} from "../../core/types"
import type { MarkdownGenerationProgress } from "../../core/types"
import type { MarkdownArtifactProgressEvent } from "@/lib/chat/markdown-artifact"
import { AnchoredMarkdown } from "./anchored-markdown"
import {
  assistantPartRenderPlan,
  type DocumentToolPart,
} from "./assistant-part-render-plan"
import { ReasoningTrace, SearchTrace, ToolTrace, DocumentTrace } from "./thinking-trace"
import { MarkdownArtifactToolPart } from "../../orchestration/artifacts/markdown-artifact-card"
import { DocumentUpdateTool } from "../../chat/message/document-update-tool"

/** data-artifact-progress 是 transient part（追加在 parts 尾部、不持久化）；
 * 按 toolCallId 取最后一次进度，与对应 tool part 原位配对。 */
function artifactProgressFor(
  message: ConversationViewMessage,
  toolCallId: string
): MarkdownGenerationProgress | undefined {
  const parts = message.uiParts ?? []
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (
      part.type === "data-artifact-progress" &&
      part.data.toolCallId === toolCallId
    ) {
      return part.data as MarkdownArtifactProgressEvent
    }
  }
  return message.markdownGeneration?.toolCallId === toolCallId
    ? message.markdownGeneration
    : undefined
}

export function AnchoredAssistantBody({
  state,
  message,
  onOpenThread,
  onOpenArtifact,
  sourceDepth = null,
  density = "default",
}: {
  state: ThreadTreeState
  message: ConversationViewMessage
  onOpenThread: (targetId: string, opts?: { keepSource?: boolean }) => void
  onOpenArtifact?: (artifactId: string) => void
  sourceDepth?: number | null
  density?: MarkdownDensity
}) {
  const renderPlan = assistantPartRenderPlan(message)

  /* 文档更新结果卡按「每文档最后一次提交」出卡：committed 永远出卡；
   * 未保存的中间结果（冲突/拒绝/错误）若同文档还有后续提交，则只留在
   * 时序轨迹里，避免“未保存”卡片与最终成功卡片并存造成误读。消息未落定
   * 时进行中的提交也计入后续尝试，防止先闪出将被覆盖的旧失败卡；消息落定
   * 后只认终态尝试，保证停止/中断时最后一个真实结果仍有收据卡。 */
  const settled = message.status !== "pending" && message.status !== "streaming"
  const lastUpdateOutcomeByDocument = new Map<string, string>()
  for (const item of renderPlan) {
    for (const documentPart of item.documents ?? []) {
      if (documentPart.type !== "tool-updateProjectDocument") continue
      const documentId = documentPart.input?.documentId
      if (!documentId) continue
      const terminal =
        documentPart.state === "output-available" ||
        documentPart.state === "output-error"
      if (terminal || !settled)
        lastUpdateOutcomeByDocument.set(documentId, documentPart.toolCallId)
    }
  }
  const showUpdateResultCard = (part: DocumentToolPart) => {
    if (part.type !== "tool-updateProjectDocument") return false
    if (part.state !== "output-available" && part.state !== "output-error")
      return false
    if (part.state === "output-available" && part.output.status === "committed")
      return true
    const documentId = part.input?.documentId
    return (
      !documentId ||
      lastUpdateOutcomeByDocument.get(documentId) === part.toolCallId
    )
  }

  return (
    <>
      {renderPlan.map(({ kind, part, index, activities, documents }) => {
        if (kind === "text" && part.type === "text") {
          return (
            <AnchoredMarkdown
              key={`${part.type}-${index}`}
              state={state}
              msg={message}
              source={part.text}
              onOpenThread={onOpenThread}
              density={density}
            />
          )
        }

        if (kind === "reasoning" && part.type === "reasoning") {
          return <ReasoningTrace key={`${part.type}-${index}`} part={part} />
        }

        if (kind === "research" && part.type === "data-research-activity") {
          return (
            <SearchTrace
              key={`${part.type}-${part.data.toolCallId}-${index}`}
              activities={activities ?? [part.data]}
              route={message.researchRoute}
              complete={message.status === "done"}
              settled={message.status !== "pending" && message.status !== "streaming"}
            />
          )
        }

        if (
          kind === "file" &&
          (part.type === "file" || part.type === "reasoning-file")
        ) {
          return (
            <a
              key={`${part.type}-${part.url}-${index}`}
              href={part.url}
              download={part.type === "file" ? part.filename : undefined}
            >
              {part.type === "file" ? (part.filename ?? "附件") : "推理文件"}
            </a>
          )
        }

        if (kind === "source-url" && part.type === "source-url") {
          return (
            <a
              key={`${part.type}-${part.url}-${index}`}
              href={part.url}
              target="_blank"
              rel="noreferrer"
            >
              {part.title ?? part.url}
            </a>
          )
        }

        if (kind === "artifact" && part.type === "tool-createMarkdownArtifact") {
          const artifactId =
            part.state === "output-available" &&
            typeof part.output?.artifactId === "string"
              ? part.output.artifactId
              : undefined
          return (
            <MarkdownArtifactToolPart
              key={`${part.type}-${part.toolCallId}-${index}`}
              part={part}
              progress={artifactProgressFor(message, part.toolCallId)}
              artifact={
                artifactId ? state.artifacts[artifactId] : undefined
              }
              sourceDepth={sourceDepth}
              settled={
                message.status !== "pending" && message.status !== "streaming"
              }
              onOpen={onOpenArtifact}
            />
          )
        }

        if (kind === "document") {
          const documentParts = documents ?? []
          return (
            <div key={`document-${index}`}>
              <DocumentTrace parts={documentParts} settled={settled} />
              {documentParts.map((documentPart) =>
                showUpdateResultCard(documentPart) ? (
                  <DocumentUpdateTool
                    key={documentPart.toolCallId}
                    part={documentPart}
                    sourceDepth={sourceDepth}
                  />
                ) : null
              )}
            </div>
          )
        }

        if (kind === "tool") {
          return (
            <ToolTrace
              key={`${part.type}-${index}`}
              toolState={"state" in part ? part.state : undefined}
              progress={message.markdownGeneration}
            />
          )
        }

        return null
      })}
    </>
  )
}
