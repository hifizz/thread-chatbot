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
    matches?: (string | { path: string; line: number; text: string })[]
    matchCount?: number
    commitUrl?: string
    pullRequest?: { url: string; number: number; draft?: boolean } | null
    warning?: string
    taskId?: string
    title?: string
    repo?: string
    branch?: string
    baseBranch?: string
    watchUrl?: string
    status?: string
    phase?: string | null
    result?: {
      outcome?: string
      changedFiles?: string[]
      pullRequest?: { url: string; number: number } | null
    } | null
  }
}

const TOOL_ICONS: Record<string, string> = {
  listRepositoryFiles: "📂",
  readRepositoryFile: "📄",
  findRepositoryPaths: "🔍",
  searchRepositoryCode: "🔍",
  commitFilesToRepository: "📤",
  dispatchAgentTask: "🚀",
  checkAgentTask: "📊",
}

function toolIcon(name: string): string {
  return TOOL_ICONS[name] ?? "🔧"
}

function toolShortName(name: string): string {
  if (name === "listRepositoryFiles") return "列目录"
  if (name === "readRepositoryFile") return "读文件"
  if (name === "findRepositoryPaths") return "找路径"
  if (name === "searchRepositoryCode") return "搜代码"
  if (name === "commitFilesToRepository") return "提交PR"
  if (name === "dispatchAgentTask") return "派任务"
  if (name === "checkAgentTask") return "查任务"
  return name
}

interface RepoToolRow {
  icon: string
  name: string
  inputLabel: string
  outputLabel: string
  outputLink: string | null
  isError: boolean
  isDone: boolean
}

function parseRepoToolPart(
  part: { type: string; [k: string]: unknown },
  repoFullName: string,
  commitSha: string | null
): RepoToolRow {
  const toolName = part.type.replace(/^tool-/, "")
  const toolState = "state" in part ? String(part.state) : ""
  const input = "input" in part ? (part.input as Record<string, unknown>) : null
  const output = "output" in part ? (part.output as ToolOutput) : null

  let inputLabel = ""
  if (input) {
    if (toolName === "readRepositoryFile") inputLabel = String(input.path ?? "")
    else if (toolName === "listRepositoryFiles") inputLabel = String(input.path || "/")
    else if (toolName === "findRepositoryPaths") inputLabel = `"${input.query ?? ""}"`
    else if (toolName === "searchRepositoryCode") {
      inputLabel = `"${input.query ?? ""}"${input.path ? `  ${input.path}` : ""}`
    }
    else if (toolName === "commitFilesToRepository") {
      const files = Array.isArray(input.files) ? input.files.length : 0
      inputLabel = `${input.branchName ?? ""} · ${files} 个文件`
    }
    else if (toolName === "dispatchAgentTask") {
      const goal = String(input.goal ?? "")
      inputLabel = goal.length > 40 ? `${goal.slice(0, 40)}…` : goal
    } else if (toolName === "checkAgentTask") inputLabel = String(input.taskId ?? "")
  }

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
        outputLabel = `第 ${s}-${e} 行`
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
        outputLabel = `${n} 个匹配${output.data.truncated ? "（部分）" : ""}`
      } else if (toolName === "searchRepositoryCode" && output.data.matches) {
        const n = output.data.matchCount ?? output.data.matches.length
        outputLabel = `${n} 个匹配${output.data.truncated ? "（部分）" : ""}`
        const first = output.data.matches[0]
        if (first && typeof first === "object") {
          outputLink = githubFileUrl(
            repoFullName,
            output.data.commitSha ?? commitSha ?? "",
            first.path,
            first.line
          )
        }
      } else if (toolName === "commitFilesToRepository") {
        const pr = output.data.pullRequest
        outputLabel = pr
          ? `PR #${pr.number}${pr.draft ? "（草稿）" : ""}`
          : `已提交 ${shortSha(output.data.commitSha ?? "")}`
        outputLink = pr?.url ?? output.data.commitUrl ?? null
        if (output.data.warning) outputLabel += ` · ${output.data.warning}`
      } else if (toolName === "dispatchAgentTask" && output.data.taskId) {
        outputLabel = `${output.data.taskId} → ${output.data.branch ?? ""}`
        outputLink = output.data.watchUrl ?? null
      } else if (toolName === "checkAgentTask") {
        const status = output.data.status ?? "unknown"
        const pr = output.data.result?.pullRequest
        outputLabel = pr ? `${status} · PR #${pr.number}` : status
        outputLink = pr?.url ?? null
      }
    }
  }

  return {
    icon: toolIcon(toolName),
    name: toolShortName(toolName),
    inputLabel,
    outputLabel,
    outputLink,
    isError,
    isDone: toolState === "output-available",
  }
}

function RepoToolGroup({
  parts,
  repoFullName,
  commitSha,
}: {
  parts: { type: string; [k: string]: unknown }[]
  repoFullName: string
  commitSha: string | null
}) {
  const rows = parts.map((p) => parseRepoToolPart(p, repoFullName, commitSha))
  const done = rows.every((r) => r.isDone)
  const errorCount = rows.filter((r) => r.isError).length
  const okCount = rows.length - errorCount
  const fileCount = rows.filter((r) => r.name === "读文件" && !r.isError).length
  const dirCount = rows.filter((r) => r.name === "列目录" && !r.isError).length
  const searchCount = rows.filter(
    (r) => (r.name === "找路径" || r.name === "搜代码") && !r.isError
  ).length
  const taskCount = rows.filter((r) => r.name === "派任务" && !r.isError).length
  const commitCount = rows.filter(
    (r) => r.name === "提交PR" && !r.isError
  ).length

  const items = [
    fileCount > 0 ? `${fileCount} 个文件` : null,
    dirCount > 0 ? `${dirCount} 个目录` : null,
    searchCount > 0 ? `${searchCount} 次查找` : null,
    commitCount > 0 ? `提交 ${commitCount} 个 PR` : null,
    taskCount > 0 ? `派发 ${taskCount} 个任务` : null,
  ].filter(Boolean)

  const readCount = fileCount + dirCount + searchCount
  const summary =
    okCount === 0
      ? "读取失败"
      : items.length > 0
        ? readCount > 0 && commitCount + taskCount === 0
          ? `读取了 ${items.join("，")}`
          : items.join("，")
        : "读取完成"

  return (
    <details className="repo-tool-group" open={!done}>
      <summary>
        <span className="repo-tool-group-icon">📁</span>
        <span className="repo-tool-group-title">
          {done ? summary : "正在读取代码…"}
        </span>
        {errorCount > 0 && (
          <span className="repo-tool-group-errors">{errorCount} 个失败</span>
        )}
        <span className="repo-tool-group-count">{rows.length} 次调用</span>
      </summary>
      <div className="repo-tool-rows">
        {rows.map((row, i) => (
          <div key={i} className={`repo-tool-row${row.isError ? " error" : ""}`}>
            <span className="repo-tool-row-icon">{row.icon}</span>
            <span className="repo-tool-row-name">{row.name}</span>
            {row.inputLabel && (
              <code className="repo-tool-row-input">{row.inputLabel}</code>
            )}
            {row.outputLabel && (
              <span className={`repo-tool-row-output${row.isError ? " error" : ""}`}>
                {row.outputLink ? (
                  <a href={row.outputLink} target="_blank" rel="noreferrer">
                    {row.outputLabel}
                  </a>
                ) : (
                  row.outputLabel
                )}
              </span>
            )}
            {!row.isDone && <span className="repo-tool-row-pending">…</span>}
          </div>
        ))}
      </div>
    </details>
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
      {renderPlan.map(({ kind, part, index, activities, parts: groupParts }) => {
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

        if (kind === "repo-tools") {
          return (
            <RepoToolGroup
              key={`repo-tools-${index}`}
              parts={(groupParts ?? [part]) as { type: string; [k: string]: unknown }[]}
              repoFullName={repoFullName}
              commitSha={commitSha}
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
