import type { WebSearchActivity, WebSearchMode } from "../core/types"

export const DEFAULT_WEB_SEARCH_MODE: WebSearchMode = "auto"
export const WEB_SEARCH_TOOL_NAME = "webSearch"

const QUERY_DISPLAY_MAX_CHARS = 240
const SOURCE_TITLE_MAX_CHARS = 160

export function isWebSearchMode(value: unknown): value is WebSearchMode {
  return value === "auto" || value === "always" || value === "off"
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function displayQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const query = value.trim()
  return query ? query.slice(0, QUERY_DISPLAY_MAX_CHARS) : undefined
}

function safeDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined
}

function safeSource(value: unknown) {
  const source = record(value)
  if (!source) return null
  if (
    typeof source.sourceId !== "string" ||
    typeof source.title !== "string" ||
    typeof source.url !== "string"
  )
    return null
  try {
    const url = new URL(source.url)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.username || url.password) return null
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      /^(?:fc|fd|fe[89ab])/i.test(hostname)
    )
      return null
    const ipv4 = hostname.split(".").map(Number)
    if (
      ipv4.length === 4 &&
      ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      const [a, b] = ipv4
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      )
        return null
    }
    return {
      sourceId: source.sourceId.slice(0, 80),
      title: source.title.trim().slice(0, SOURCE_TITLE_MAX_CHARS) || url.hostname,
      url: url.toString(),
    }
  } catch {
    return null
  }
}

function safeFailureMessage(code: unknown): string {
  switch (code) {
    case "not_configured":
    case "missing_config":
    case "missing_configuration":
      return "联网搜索暂不可用"
    case "timeout":
      return "联网搜索超时，回答将基于已有知识继续"
    case "rate_limited":
      return "联网搜索请求过于频繁，回答将基于已有知识继续"
    case "budget_exhausted":
      return "已达到本轮联网搜索上限"
    case "empty_results":
    case "all_results_filtered":
      return "未找到可用的信息源"
    default:
      return "联网搜索失败，回答将基于已有知识继续"
  }
}

export interface WebSearchStreamEvent {
  activity: WebSearchActivity
}

/**
 * 为单次响应创建 Web Search 工具流分派器。只接受已知 call id 的 output，且只把
 * query、计数、耗时和规范化公开 URL 交给 UI；provider 原始 payload/错误不会外泄。
 */
export function createWebSearchEventDispatcher(
  onEvent: (event: WebSearchStreamEvent) => void,
  now: () => number = Date.now
): (chunk: unknown) => boolean {
  const calls = new Map<
    string,
    { startedAt: number; query?: string; completed: boolean }
  >()

  return (chunk) => {
    const value = record(chunk)
    if (!value || typeof value.type !== "string") return false
    if (value.type === "finish") {
      for (const [toolCallId, call] of calls) {
        if (call.completed) continue
        call.completed = true
        onEvent({
          activity: {
            toolCallId,
            phase: "failed",
            ...(call.query ? { query: call.query } : {}),
            durationMs: Math.max(0, now() - call.startedAt),
            error: "搜索未返回完整结果，回答将基于已有知识继续",
          },
        })
      }
      // 只补齐活动终态，不吞掉 finish；ui-stream 仍需触发 onFinish。
      return false
    }
    const toolCallId =
      typeof value.toolCallId === "string" ? value.toolCallId.trim() : ""
    if (!toolCallId) return false

    if (
      value.type === "tool-input-start" &&
      value.toolName === WEB_SEARCH_TOOL_NAME
    ) {
      calls.set(toolCallId, { startedAt: now(), completed: false })
      onEvent({ activity: { toolCallId, phase: "starting" } })
      return true
    }

    if (
      (value.type === "tool-input-available" ||
        value.type === "tool-input-error") &&
      value.toolName === WEB_SEARCH_TOOL_NAME
    ) {
      const call = calls.get(toolCallId) ?? {
        startedAt: now(),
        completed: false,
      }
      calls.set(toolCallId, call)
      if (value.type === "tool-input-error") {
        call.completed = true
        onEvent({
          activity: {
            toolCallId,
            phase: "failed",
            durationMs: Math.max(0, now() - call.startedAt),
            error: "搜索词无效，回答将不使用联网结果",
          },
        })
        return true
      }
      const input = record(value.input)
      const query = displayQuery(input?.query)
      if (!query) return true
      call.query = query
      onEvent({ activity: { toolCallId, phase: "searching", query } })
      return true
    }

    const call = calls.get(toolCallId)
    if (!call || call.completed) return false

    if (value.type === "tool-output-error") {
      call.completed = true
      onEvent({
        activity: {
          toolCallId,
          phase: "failed",
          ...(call.query ? { query: call.query } : {}),
          durationMs: Math.max(0, now() - call.startedAt),
          error: safeFailureMessage(undefined),
        },
      })
      return true
    }

    if (value.type !== "tool-output-available") return false
    const output = record(value.output)
    if (!output) return false
    call.completed = true
    const query = displayQuery(output.query) ?? call.query
    const durationMs =
      safeDuration(output.latencyMs) ??
      safeDuration(output.durationMs) ??
      Math.max(0, now() - call.startedAt)
    const error = record(output.error)
    const errorCode =
      error?.code ??
      (typeof output.error === "string" ? output.error : output.code)
    const status = typeof output.status === "string" ? output.status : undefined
    const failed =
      output.ok === false ||
      output.success === false ||
      status === "error" ||
      status === "failed" ||
      error !== null

    if (failed) {
      onEvent({
        activity: {
          toolCallId,
          phase: "failed",
          ...(query ? { query } : {}),
          durationMs,
          error: safeFailureMessage(errorCode),
        },
      })
      return true
    }

    const results = Array.isArray(output.results) ? output.results : []
    const sources = results.flatMap((item) => {
      const source = safeSource(item)
      return source ? [source] : []
    })
    onEvent({
      activity: {
        toolCallId,
        phase: "completed",
        ...(query ? { query } : {}),
        resultCount: sources.length,
        durationMs,
        ...(sources.length ? { sources } : {}),
      },
    })
    return true
  }
}
