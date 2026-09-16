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

function githubFileUrl(
  repo: string,
  sha: string,
  path: string,
  startLine?: number,
  endLine?: number
): string {
  const base = `https://github.com/${repo}/blob/${sha}/${path}`
  if (startLine && endLine && startLine !== endLine)
    return `${base}#L${startLine}-L${endLine}`
  if (startLine) return `${base}#L${startLine}`
  return base
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

// ── 仓库工具过程卡 ──────────────────────────────────────────────

interface ToolOutput {
  ok?: boolean
  code?: string
  message?: string
  data?: {
    entries?: Array<{ name: string; path: string; type: string }>
    commitSha?: string
    path?: string
    startLine?: number
    endLine?: number
    truncated?: boolean
    matches?: string[]
  }
}

function RepoToolCard({
  part,
  repoFullName,
  commitSha,
}: {
  part: { type: string; [k: string]: unknown }
  repoFullName: string
  commitSha: string | null
}) {
  const toolName = part.type.replace(/^tool-/, "")
  const toolState = "state" in part ? String(part.state) : ""
  const input = "input" in part ? (part.input as Record<string, unknown>) : null
  const output = "output" in part ? (part.output as ToolOutput) : null

  // ── 输入摘要 ──
  let inputLabel = ""
  if (input) {
    if (toolName === "readRepositoryFile") {
      inputLabel = String(input.path ?? "")
    } else if (toolName === "listRepositoryFiles") {
      inputLabel = String(input.path || "/")
    } else if (toolName === "findRepositoryPaths") {
      inputLabel = `"${input.query ?? ""}"`
    }
  }

  // ── 输出摘要 ──
  let outputLabel = ""
  let outputLink: string | null = null
  let isError = false
  if (output) {
    if (output.ok === false) {
      isError = true
      outputLabel = output.message ?? output.code ?? "失败"
    } else if (output.ok === true && output.data) {
      if (toolName === "listRepositoryFiles" && output.data.entries) {
        const dirs = output.data.entries.filter((e) => e.type === "dir").length
        const files = output.data.entries.length - dirs
        outputLabel = `${files} 个文件${dirs > 0 ? `，${dirs} 个目录` : ""}`
      } else if (toolName === "readRepositoryFile") {
        const s = output.data.startLine
        const e = output.data.endLine
        const trunc = output.data.truncated ? "（截断）" : ""
        outputLabel = `第 ${s}-${e} 行${trunc}`
        if (output.data.path) {
          outputLink = githubFileUrl(
            repoFullName,
            output.data.commitSha ?? commitSha ?? "",
            output.data.path,
            s,
            e
          )
        }
      } else if (toolName === "findRepositoryPaths" && output.data.matches) {
        const n = output.data.matches.length
        const trunc = output.data.truncated ? "（部分）" : ""
        outputLabel = `${n} 个匹配${trunc}`
      }
    }
  }

  const isDone = toolState === "output-available"
  const isStreaming = toolState === "input-streaming" || toolState === "input-available"

  return (
    <div className={`repo-tool-card${isDone ? " done" : ""}${isError ? " error" : ""}`}>
      <span className="repo-tool-icon">
        {isDone ? (isError ? "✕" : "✓") : "⋯"}
      </span>
      <span className="repo-tool-name">{toolName}</span>
      {inputLabel && (
        <code className="repo-tool-input">{inputLabel}</code>
      )}
      {outputLabel && (
        <span className={`repo-tool-output${isError ? " error" : ""}`}>
          {outputLink ? (
            <a href={outputLink} target="_blank" rel="noreferrer">
              {outputLabel}
            </a>
          ) : (
            outputLabel
          )}
        </span>
      )}
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

  // 从 uiParts 中提取仓库上下文，供工具卡显示链接
  const repoCtx = (message.uiParts ?? []).find(
    (p) => p.type === "data-repo-context"
  ) as { type: string; data: RepoContextData } | undefined
  const repoFullName = repoCtx?.data?.repositoryFullName ?? ""
  const commitSha = repoCtx?.data?.commitSha ?? null

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
            return (
              <RepoToolCard
                key={`${part.type}-${index}`}
                part={part as { type: string; [k: string]: unknown }}
                repoFullName={repoFullName}
                commitSha={commitSha}
              />
            )
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
