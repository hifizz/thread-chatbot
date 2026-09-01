import type { LanguageModelUsage, TextStreamPart, ToolSet } from "ai"

export interface RetryableTextStreamResult {
  stream: ReadableStream<TextStreamPart<ToolSet>>
  usage: PromiseLike<LanguageModelUsage>
}

export interface CacheControlFallbackResult extends RetryableTextStreamResult {
  fallbackUsed: Promise<boolean>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    const fields = [record.message, record.error, record.responseBody]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
    if (fields) return fields
  }
  return ""
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const record = error as Record<string, unknown>
  for (const value of [record.status, record.statusCode, record.httpStatus]) {
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * Narrowly recognizes cache-option compatibility failures. Authentication,
 * quota, safety, model and ordinary request errors must not be hidden by a retry.
 */
export function isPromptCacheControlRejection(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  if (!message) return false
  const mentionsControl = [
    "cache_control",
    "cache control",
    "prompt cache",
    "caching",
    "cached_tokens",
    "x-session-id",
    "session_id",
  ].some((needle) => message.includes(needle))
  if (!mentionsControl) return false
  const status = errorStatus(error)
  return status === undefined || status === 400 || status === 404 || status === 422
}

function errorPart(error: unknown): TextStreamPart<ToolSet> {
  return { type: "error", error } as TextStreamPart<ToolSet>
}

function partError(part: TextStreamPart<ToolSet>): unknown | null {
  if (part.type !== "error") return null
  return "error" in part ? part.error : part
}

/**
 * Retries once without cache controls only when the first attempt fails before
 * exposing any stream part and the failure is specifically about cache fields.
 * Once output is visible, fallback is forbidden to avoid duplicated answers or
 * repeated tool side effects.
 */
export function withCacheControlFallback(input: {
  enabled: boolean
  primary: () => RetryableTextStreamResult
  fallback: () => RetryableTextStreamResult
  onFallback?: (error: unknown) => void
}): CacheControlFallbackResult {
  let selected: RetryableTextStreamResult
  let fallbackUsed = false
  let fallbackResolve!: (value: boolean) => void
  const fallbackPromise = new Promise<boolean>((resolve) => {
    fallbackResolve = resolve
  })

  try {
    selected = input.primary()
  } catch (error) {
    if (!input.enabled || !isPromptCacheControlRejection(error)) throw error
    fallbackUsed = true
    input.onFallback?.(error)
    selected = input.fallback()
  }

  let reader = selected.stream.getReader()
  let exposed = false
  let settled = false
  let usageResolve!: (usage: LanguageModelUsage) => void
  let usageReject!: (error: unknown) => void
  const usage = new Promise<LanguageModelUsage>((resolve, reject) => {
    usageResolve = resolve
    usageReject = reject
  })

  const settleUsage = () => {
    if (settled) return
    settled = true
    Promise.resolve(selected.usage).then(usageResolve, usageReject)
    fallbackResolve(fallbackUsed)
  }

  const switchToFallback = async (error: unknown) => {
    if (!input.enabled || fallbackUsed || exposed) return false
    if (!isPromptCacheControlRejection(error)) return false
    fallbackUsed = true
    input.onFallback?.(error)
    await reader.cancel(error).catch(() => undefined)
    selected = input.fallback()
    reader = selected.stream.getReader()
    return true
  }

  const stream = new ReadableStream<TextStreamPart<ToolSet>>({
    async pull(controller) {
      while (true) {
        try {
          const next = await reader.read()
          if (next.done) {
            settleUsage()
            controller.close()
            return
          }
          const failure = partError(next.value)
          if (failure !== null && (await switchToFallback(failure))) continue
          exposed = true
          controller.enqueue(next.value)
          return
        } catch (error) {
          if (await switchToFallback(error)) continue
          settleUsage()
          controller.error(error)
          return
        }
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined)
      settleUsage()
    },
  })

  // Defensive: this makes impossible TypeScript narrowing failures explicit
  // without allowing a rejected primary creation to escape as an empty stream.
  if (!stream) {
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(errorPart(new Error("CACHE_FALLBACK_STREAM_FAILED")))
          controller.close()
        },
      }),
      usage,
      fallbackUsed: fallbackPromise,
    }
  }

  return { stream, usage, fallbackUsed: fallbackPromise }
}
