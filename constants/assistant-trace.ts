// 正式聊天过程的产品状态文案，多个步骤共用同一套语义。
export const ASSISTANT_TRACE_TOOL_LABELS: Record<string, string> = {
  webSearch: "搜索网页",
  readUrl: "读取网页",
}

export const ASSISTANT_THINKING_LABEL = "Thinking..."

export const RESEARCH_SUBQUESTION_ID_DESCRIPTION = "研究计划中当前子问题的 id；无计划时省略"

// 思考详情滚动边缘的渐隐范围，避免遮住整行内容。
export const ASSISTANT_TRACE_SHADOW_SIZE = 24
