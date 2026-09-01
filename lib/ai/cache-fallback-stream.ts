import { isCacheControlCompatibilityError } from "@/lib/ai/prompt-cache-probe"

export interface CacheFallbackAttempt<TChunk, TUsage> {
  stream: ReadableStream<TChunk>
  usage: PromiseLike<TUsage>
}

export interface CacheFallbackStreamResult<TChunk, TUsage> {
  stream: ReadableStream<TChunk>
  usage: Promise<TUsage>
  fallbackUsed: Promise<boolean>
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function errorFromChunk(value: unknown): unknown | null {
  if (typeof value !== "object" || value === null) return null
  const chunk = value as Record<string, unknown>
  return chunk.type === "error" ? (chunk.error ?? chunk) : null
}

/**
 * 只在首个 attempt 尚未输出任何非错误 Chunk 时重试。这样缓存兼容问题不会
 * 把原本可成功的回答变成 failed，也不会在已经产生正文/工具副作用后重复请求。
 */
export function createCacheFallbackStream<TChunk, TUsage>(input: {
  cacheControlEnabled: boolean
  createAttempt: (cacheControlEnabled: boolean) => CacheFallbackAttempt<TChunk, TUsage>
  isCompatibilityError?: (error: unknown) => boolean
  errorFromChunk?: (chunk: TChunk) => unknown | null
  onFallback?: (error: unknown) => void
}): CacheFallbackStreamResult<TChunk, TUsage> {
  const usageDeferred = deferred<TUsage>()
  const fallbackDeferred = deferred<boolean>()
  const compatibility =
    input.isCompatibilityError ?? isCacheControlCompatibilityError
  const chunkError = input.errorFromChunk ?? errorFromChunk

  const stream = new ReadableStream<TChunk>({
    start(controller) {
      void (async () => {
        let fallbackUsed = false
        let settledFallback = false
        const settleFallback = (value: boolean) => {
          if (settledFallback) return
          settledFallback = true
          fallbackDeferred.resolve(value)
        }

        const pump = async (cacheControlEnabled: boolean): Promise<void> => {
          let attempt: CacheFallbackAttempt<TChunk, TUsage>
          try {
            attempt = input.createAttempt(cacheControlEnabled)
          } catch (error) {
            if (
              cacheControlEnabled &&
              input.cacheControlEnabled &&
              compatibility(error)
            ) {
              fallbackUsed = true
              input.onFallback?.(error)
              return pump(false)
            }
            throw error
          }

          const reader = attempt.stream.getReader()
          let emitted = false
          try {
            while (true) {
              const next = await reader.read()
              if (next.done) break
              const providerError = chunkError(next.value)
              if (
                providerError &&
                !emitted &&
                cacheControlEnabled &&
                input.cacheControlEnabled &&
                compatibility(providerError)
              ) {
                fallbackUsed = true
                input.onFallback?.(providerError)
                await reader.cancel(providerError).catch(() => undefined)
                return pump(false)
              }
              emitted = true
              controller.enqueue(next.value)
            }
            usageDeferred.resolve(await Promise.resolve(attempt.usage))
          } catch (error) {
            if (
              !emitted &&
              cacheControlEnabled &&
              input.cacheControlEnabled &&
              compatibility(error)
            ) {
              fallbackUsed = true
              input.onFallback?.(error)
              return pump(false)
            }
            throw error
          } finally {
            reader.releaseLock()
          }
        }

        try {
          await pump(input.cacheControlEnabled)
          settleFallback(fallbackUsed)
          controller.close()
        } catch (error) {
          settleFallback(fallbackUsed)
          usageDeferred.reject(error)
          controller.error(error)
        }
      })()
    },
  })

  return {
    stream,
    usage: usageDeferred.promise,
    fallbackUsed: fallbackDeferred.promise,
  }
}
