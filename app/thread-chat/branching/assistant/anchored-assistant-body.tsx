"use client"

import type { MarkdownDensity } from "../../chat/message/markdown-body"
import type {
  ConversationViewMessage,
  ThreadTreeState,
} from "../../core/types"
import type { MarkdownGenerationProgress } from "../../core/types"
import type { MarkdownArtifactProgressEvent } from "@/lib/chat/markdown-artifact"
import type { RepoContextData } from "@/lib/thread-chat/contracts/ui-message"
import { AnchoredMarkdown } from "./anchored-markdown"
import { assistantPartRenderPlan } from "./assistant-part-render-plan"
import { ReasoningTrace, SearchTrace, ToolTrace } from "./thinking-trace"
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

function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

function RepoContextChip({ data }: { data: RepoContextData }) {
  if (data.status === "unavailable") {
    return (
      <div className="repo-context-chip unavailable">
        <span className="repo-context-icon">📁</span>
        <span>
          {data.repositoryFullName}@{data.branch} 不可用
          {data.error ? `：${data.error}` : ""}
        </span>
      </div>
    )
  }
  return (
    <div className="repo-context-chip">
      <span className="repo-context-icon">📁</span>
      <span className="repo-context-repo">
        {data.repositoryFullName}
      </span>
      <span className="repo-context-sep">·</span>
      <span className="repo-context-branch">{data.branch}</span>
      <span className="repo-context-sep">@</span>
      <code className="repo-context-sha">
        {data.commitSha ? shortSha(data.commitSha) : "..."}
      </code>
      {data.bindingChanged && (
        <span className="repo-context-hint">已切换</span>
      )}
      {data.previousCommitSha &&
        data.previousCommitSha !== data.commitSha && (
          <span className="repo-context-hint">分支已更新</span>
        )}
    </div>
  )
}

function RepoToolCard({ part }: { part: { type: string; [k: string]: unknown } }) {
  const toolName = part.type.replace(/^tool-/, "")
  const toolState = "state" in part ? String(part.state) : ""
  let label = toolName
  let detail = ""
  if (toolState === "input-streaming" || toolState === "input-available") {
    const input = "input" in part ? (part.input as Record<string, unknown>) : null
    if (input) {
      if (toolName === "readRepositoryFile") {
        detail = String(input.path ?? "")
      } else if (toolName === "listRepositoryFiles") {
        detail = String(input.path || "/")
      } else if (toolName === "findRepositoryPaths") {
        detail = String(input.query ?? "")
      }
    }
    label = `${toolName}(${detail})`
  }
  const isDone = toolState === "output-available"
  return (
    <div className={`repo-tool-card${isDone ? " done" : ""}`}>
      <span className="repo-tool-icon">{isDone ? "✓" : "⋯"}</span>
      <span className="repo-tool-label">{label}</span>
    </div>
  )
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

  return (
    <>
      {renderPlan.map(({ kind, part, index, activities }) => {
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

        if (kind === "repo-context" && part.type === "data-repo-context") {
          return <RepoContextChip key={`${part.type}-${index}`} data={part.data} />
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

        if (
          kind === "document" &&
          (part.type === "tool-findProjectDocuments" ||
            part.type === "tool-readProjectDocument" ||
            part.type === "tool-updateProjectDocument")
        ) {
          return (
            <DocumentUpdateTool key={part.toolCallId} part={part} />
          )
        }

        if (kind === "tool") {
          const toolName = part.type.replace(/^tool-/, "")
          const isRepoTool =
            toolName === "listRepositoryFiles" ||
            toolName === "readRepositoryFile" ||
            toolName === "findRepositoryPaths"
          if (isRepoTool) {
            return <RepoToolCard key={`${part.type}-${index}`} part={part as { type: string; [k: string]: unknown }} />
          }
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
