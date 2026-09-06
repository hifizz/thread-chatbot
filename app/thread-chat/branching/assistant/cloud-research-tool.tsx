"use client"

import { CLOUD_RESEARCH_TOOL_LABELS } from "@/constants/cloud-research"
import type { ThreadChatUIPart } from "./assistant-part-render-plan"
import type { CloudToolOutput } from "@/lib/cloud-research/generation"

export function CloudResearchTool({ part, generating }: { part: ThreadChatUIPart; generating: boolean }) {
  const name = part.type.slice(5)
  const output = "output" in part ? part.output as CloudToolOutput | undefined : undefined
  const failed = output?.status === "failed" || ("state" in part && part.state === "output-error")
  const completed = output?.status === "completed"
  const status = failed ? "失败" : completed ? "完成" : generating ? "进行中" : "未完成"
  const url = output?.url && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(output.url) ? output.url : null
  return (
    <div className="cloud-research-tool" data-cloud-tool={name}>
      <div className="cloud-research-heading" role="status">
        <strong>{CLOUD_RESEARCH_TOOL_LABELS[name]}</strong>
        <span>{status}</span>
      </div>
      <p>{output?.detail ?? "正在准备工具参数…"}</p>
      {output?.text && (
        <details>
          <summary>查看执行结果{output.truncated ? "（部分内容）" : ""}</summary>
          <pre>{output.text}</pre>
        </details>
      )}
      {url && <a href={url} target="_blank" rel="noreferrer">打开报告 PR ↗</a>}
    </div>
  )
}
