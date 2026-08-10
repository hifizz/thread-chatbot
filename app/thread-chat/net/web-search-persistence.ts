import type { Message, WebSearchActivity } from "../core/types"

const isTerminalSearchActivity = (activity: WebSearchActivity) =>
  activity.phase === "completed" || activity.phase === "failed"

/**
 * 只保留可在刷新后重放的消息级搜索结果。进行中的调用属于当前连接，不能复活；
 * 已完成/失败的聚合证据及其正文位置属于已生成消息，可以随 branch tree 持久化。
 */
export function persistableWebSearchState(message: Message): {
  activities: WebSearchActivity[] | undefined
  textOffset: number | undefined
} {
  if (message.role !== "assistant") {
    return { activities: undefined, textOffset: undefined }
  }

  const currentActivities = message.webSearchActivities
  const terminalActivities = currentActivities?.filter(isTerminalSearchActivity)
  const activities = terminalActivities?.length
    ? terminalActivities.length === currentActivities?.length
      ? currentActivities
      : terminalActivities
    : undefined

  const rawOffset = message.webSearchActivityTextOffset
  const textOffset =
    activities && typeof rawOffset === "number" && Number.isFinite(rawOffset)
      ? Math.min(message.text.length, Math.max(0, Math.floor(rawOffset)))
      : undefined

  return { activities, textOffset }
}
