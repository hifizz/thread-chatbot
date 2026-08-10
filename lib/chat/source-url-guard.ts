import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai"
import { compactSourceLabel } from "./source-label.ts"

export type SourceUrlGuardState = {
  active: boolean
  allowedUrls: Set<string>
  sources: Map<string, string>
}

const URL_PATTERN = /https?:\/\/[^\s<>()\[\]{}"'，。；：！？、（）【】《》]+/g
const SCHEMES = ["http://", "https://"]

function trailingSchemePrefixLength(value: string): number {
  const max = Math.min(value.length, "https://".length - 1)
  for (let length = max; length > 0; length -= 1) {
    const suffix = value.slice(-length).toLowerCase()
    if (SCHEMES.some((scheme) => scheme.startsWith(suffix))) return length
  }
  return 0
}

export function sanitizeSourceUrls(
  value: string,
  allowedUrls: ReadonlySet<string>,
  final = true
): { text: string; pending: string; acceptedUrls: string[] } {
  let text = ""
  let cursor = 0
  const acceptedUrls: string[] = []
  URL_PATTERN.lastIndex = 0

  for (let match = URL_PATTERN.exec(value); match; match = URL_PATTERN.exec(value)) {
    const url = match[0]
    const end = match.index + url.length
    text += value.slice(cursor, match.index)
    if (!final && end === value.length) {
      return { text, pending: value.slice(match.index), acceptedUrls }
    }
    if (allowedUrls.has(url)) {
      text += url
      acceptedUrls.push(url)
    } else {
      text += "[未核验链接已移除]"
    }
    cursor = end
  }

  const remainder = value.slice(cursor)
  if (!final) {
    const prefixLength = trailingSchemePrefixLength(remainder)
    if (prefixLength > 0) {
      return {
        text: text + remainder.slice(0, -prefixLength),
        pending: remainder.slice(-prefixLength),
        acceptedUrls,
      }
    }
  }
  return { text: text + remainder, pending: "", acceptedUrls }
}

export function buildSourceFooter(
  sources: ReadonlyMap<string, string>
): string {
  if (sources.size === 0) return ""
  const links = [...sources.entries()]
    .slice(0, 3)
    .map(([url, title], index) => {
      const safeTitle = title.replace(/[\[\]\n\r]/g, " ").trim()
      const label = compactSourceLabel(safeTitle, url)
      return `[${label || `来源 ${index + 1}`}](${url})`
    })
  return `\n\n信息源：${links.join(" · ")}`
}

/**
 * 搜索发生后，只允许模型输出本轮工具实际返回的 URL。按 URL 候选做小窗口缓冲，
 * 保留其余 token 流式输出；跨 chunk 的 URL 也不能绕过校验。
 */
export function createSourceUrlGuardTransform<TOOLS extends ToolSet>(
  state: SourceUrlGuardState
): StreamTextTransform<TOOLS> {
  return () => {
    let pending = ""
    let footerEmitted = false
    const citedUrls = new Set<string>()
    let lastTextChunk: Extract<TextStreamPart<TOOLS>, { type: "text-delta" }> | null =
      null

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (!state.active || chunk.type !== "text-delta") {
          if (pending && lastTextChunk) {
            const sanitized = sanitizeSourceUrls(
              pending,
              state.allowedUrls,
              true
            )
            for (const url of sanitized.acceptedUrls) citedUrls.add(url)
            if (sanitized.text)
              controller.enqueue({ ...lastTextChunk, text: sanitized.text })
            pending = ""
          }
          if (
            state.active &&
            chunk.type === "finish" &&
            !footerEmitted &&
            lastTextChunk
          ) {
            const footer =
              citedUrls.size === 0 ? buildSourceFooter(state.sources) : ""
            if (footer) controller.enqueue({ ...lastTextChunk, text: footer })
            footerEmitted = true
          }
          controller.enqueue(chunk)
          return
        }

        lastTextChunk = chunk
        const sanitized = sanitizeSourceUrls(
          pending + chunk.text,
          state.allowedUrls,
          false
        )
        pending = sanitized.pending
        for (const url of sanitized.acceptedUrls) citedUrls.add(url)
        if (sanitized.text) {
          controller.enqueue({ ...chunk, text: sanitized.text })
        }
      },
      flush(controller) {
        if (!lastTextChunk) return
        const sanitizedPending = pending
          ? sanitizeSourceUrls(pending, state.allowedUrls, true)
          : null
        for (const url of sanitizedPending?.acceptedUrls ?? [])
          citedUrls.add(url)
        const text =
          (sanitizedPending?.text ?? "") +
          (footerEmitted || citedUrls.size > 0
            ? ""
            : buildSourceFooter(state.sources))
        if (text) controller.enqueue({ ...lastTextChunk, text })
      },
    })
  }
}
