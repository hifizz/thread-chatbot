type ToolChoice =
  | "auto"
  | "required"
  | { type: "tool"; toolName: string }

export type ThreadChatStepPolicy = {
  activeTools: string[]
  toolChoice: ToolChoice
}

export function buildThreadChatStepPolicy({
  stepNumber,
  searchMode,
  searchEnabled,
  searchBudgetRemaining,
  forceMarkdownArtifact,
  calledToolNames,
  markdownArtifactToolName,
  webSearchToolName,
}: {
  stepNumber: number
  searchMode: "auto" | "always" | "off"
  searchEnabled: boolean
  searchBudgetRemaining: number
  forceMarkdownArtifact: boolean
  calledToolNames: readonly string[]
  markdownArtifactToolName: string
  webSearchToolName: string
}): ThreadChatStepPolicy {
  const searchAvailable =
    searchEnabled && searchMode !== "off" && searchBudgetRemaining > 0
  const artifactCreated = calledToolNames.includes(markdownArtifactToolName)
  const searchCalled = calledToolNames.includes(webSearchToolName)
  // GLM-5.2 偶尔会在预算耗尽后重复输出已用过的工具名。保留 schema 让 AI SDK
  // 返回结构化 budget_exhausted，而不是抛 NoSuchTool；不会重新访问 provider。
  const keepKnownSearchTool = searchMode !== "off" && searchCalled
  const activeSearchTools =
    searchAvailable || keepKnownSearchTool ? [webSearchToolName] : []

  if (stepNumber === 0 && searchAvailable && searchMode === "always") {
    return {
      activeTools: activeSearchTools,
      toolChoice: { type: "tool", toolName: webSearchToolName },
    }
  }

  if (forceMarkdownArtifact && !artifactCreated) {
    // 搜索已发生后立即完成确定性的 Markdown 交付；off/不可用时保持原有首步强制行为。
    if (searchCalled || !searchAvailable) {
      return {
        activeTools: [...activeSearchTools, markdownArtifactToolName],
        toolChoice: {
          type: "tool",
          toolName: markdownArtifactToolName,
        },
      }
    }

    // auto 下让模型在“先搜当前事实”与“直接交付稳定内容”之间选择，但确保首步会选一个工具。
    return {
      activeTools: [...activeSearchTools, markdownArtifactToolName],
      toolChoice: "required",
    }
  }

  return {
    activeTools: [
      ...activeSearchTools,
      markdownArtifactToolName,
    ],
    toolChoice: "auto",
  }
}
