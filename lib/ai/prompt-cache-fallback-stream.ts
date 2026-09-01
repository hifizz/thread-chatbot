export type PromptCacheStreamResult<TChunk, TUsage> = {
  stream: ReadableStream<TChunk>
  usage: PromiseLike<TUsage>
}

export type PromptCacheFallbackStream<TChunk, TUsage> = {
  stream: ReadableStream<TChunk>
  usage: Promise<TUsage>
  usedFallback: () => boolean
  /** Milliseconds from wrapper creation to the first emitted protocol chunk. */
  ttftMs: () => number | undefined
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

/**
 * Retry without cache controls only when the primary request fails before it
 * emits any protocol chunk. Once output begins, retrying could duplicate tool
 * calls or visible text, so the original error is preserved.
 */
export function createPromptCacheFallbackStream<TChunk, TUsage>(input: {
  primary: () => PromptCacheStreamResult<TChunk, TUsage>
  fallback: () => PromptCacheStreamResult<TChunk, TUsage>
  isCacheControlRejection: (error: unknown) => boolean
  enabled: boolean
  onFallback?: (error: unknown) => void
}): PromptCacheFallbackStream<TChunk, TUsage> {
  const usage = deferred<TUsage>()
  const startedAt = performance.now()
  let firstChunkAt: number | undefined
  let fallbackUsed = false
  let activeReader: ReadableStreamDefaultReader<TChunk> | null = null
  let cancelled = false
  let cancelReason: unknown

  async function pipe(
    result: PromptCacheStreamResult<TChunk, TUsage>,
    controller: ReadableStreamDefaultController<TChunk>,
    mayFallback: boolean
  ): Promise<void> {
    let emitted = false
    // Attach a rejection handler immediately. A cache-control request can fail
    // both its protocol stream and its separate usage promise; when we safely
    // fall back, the rejected primary usage must not become an unhandled error.
    const resultUsage = Promise.resolve(result.usage)
    void resultUsage.catch(() => undefined)
    activeReader = result.stream.getReader()
    try {
      while (true) {
        const next = await activeReader.read()
        if (next.done) break
        emitted = true
        firstChunkAt ??= performance.now()
        controller.enqueue(next.value)
      }
      usage.resolve(await resultUsage)
      controller.close()
    } catch (error) {
      if (
        mayFallback &&
        input.enabled &&
        !emitted &&
        input.isCacheControlRejection(error)
      ) {
        fallbackUsed = true
        input.onFallback?.(error)
        if (cancelled) {
          usage.reject(cancelReason)
          controller.error(cancelReason)
          return
        }
        await pipe(input.fallback(), controller, false)
        return
      }
      usage.reject(error)
      controller.error(error)
    } finally {
      activeReader?.releaseLock()
      activeReader = null
    }
  }

  const stream = new ReadableStream<TChunk>({
    start(controller) {
      try {
        void pipe(input.primary(), controller, true)
      } catch (error) {
        if (input.enabled && input.isCacheControlRejection(error)) {
          fallbackUsed = true
          input.onFallback?.(error)
          try {
            void pipe(input.fallback(), controller, false)
          } catch (fallbackError) {
            usage.reject(fallbackError)
            controller.error(fallbackError)
          }
        } else {
          usage.reject(error)
          controller.error(error)
        }
      }
    },
    async cancel(reason) {
      cancelled = true
      cancelReason = reason
      await activeReader?.cancel(reason)
    },
  })

  return {
    stream,
    usage: usage.promise,
    usedFallback: () => fallbackUsed,
    ttftMs: () =>
      firstChunkAt === undefined ? undefined : firstChunkAt - startedAt,
  }
}
