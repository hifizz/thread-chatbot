"use client"

import type {
  ConversationViewMessage,
  ThreadTreeState,
} from "../../core/types"
import {
  MarkdownArtifactCard,
  MarkdownArtifactStreamTrace,
} from "./markdown-artifact-card"
import { selectMessageArtifacts } from "./message-artifacts-logic"

/**
 * 消息气泡之后的 artifact 兜底区：
 * 正常路径下 artifact 卡片 / 生成块已在 tool part 原位渲染（AnchoredAssistantBody），
 * 这里只兜底两类数据漂移——
 *   1. artifactIds 里存在、但 uiParts 没有对应 tool part 的 artifact（历史数据）；
 *   2. 有生成进度却没有对应 tool part 的极端情况。
 */
export function MessageArtifacts({
  state,
  message,
  compact = false,
  onOpen,
}: {
  state?: ThreadTreeState
  message: ConversationViewMessage
  compact?: boolean
  onOpen?: (artifactId: string) => void
}) {
  const inlineArtifactIds = new Set(
    (message.uiParts ?? []).flatMap((part) => {
      if (
        part.type === "tool-createMarkdownArtifact" &&
        part.state === "output-available" &&
        part.output?.created &&
        typeof part.output.artifactId === "string"
      )
        return [part.output.artifactId]
      // 文档更新提交的修订版本 artifact：详情由 DocumentUpdateTool 结果卡片承载，
      // 不在气泡后重复渲染。
      if (
        part.type === "tool-updateProjectDocument" &&
        part.state === "output-available" &&
        part.output?.status === "committed" &&
        typeof part.output.artifactId === "string"
      )
        return [part.output.artifactId]
      return []
    })
  )
  const hasToolPart = (message.uiParts ?? []).some(
    (part) =>
      part.type === "tool-createMarkdownArtifact" &&
      part.toolCallId === message.markdownGeneration?.toolCallId
  )
  const artifacts = onOpen
    ? selectMessageArtifacts(state, message).filter(
        (artifact) => !inlineArtifactIds.has(artifact.id)
      )
    : []
  const orphanProgress = Boolean(
    message.markdownGeneration && !hasToolPart
  )
  if (!orphanProgress && artifacts.length === 0) return null

  return (
    <>
      {orphanProgress && (
        <MarkdownArtifactStreamTrace
          progress={message.markdownGeneration}
          compact={compact}
        />
      )}
      {onOpen &&
        artifacts.map((artifact) => (
          <MarkdownArtifactCard
            key={artifact.id}
            artifact={artifact}
            sourceDepth={state?.threads[artifact.sourceThreadId]?.depth ?? null}
            onOpen={onOpen}
            compact={compact}
          />
        ))}
    </>
  )
}
