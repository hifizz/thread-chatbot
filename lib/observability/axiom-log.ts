const AXIOM_LOG_PREFIX = "[axiom]"
const DEFAULT_BATCH_SIZE = 25
const DEFAULT_FLUSH_INTERVAL_MS = 250

type AxiomEvent = Record<string, string | number | boolean | undefined>

type AxiomConfig = {
  token: string
  dataset: string
  edgeUrl: string
}

let queue: AxiomEvent[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let flushing: Promise<void> | undefined

function readAxiomConfig(source: NodeJS.ProcessEnv = process.env): AxiomConfig | undefined {
  const token = source.AXIOM_TOKEN?.trim()
  const dataset = source.AXIOM_DATASET?.trim()
  const edgeUrl = source.AXIOM_EDGE_URL?.trim().replace(/\/$/, "")
  if (!token || !dataset || !edgeUrl) return undefined
  return { token, dataset, edgeUrl }
}

export function axiomConfigured(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(readAxiomConfig(source))
}

function scheduleFlush() {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    void flushAxiomLogs()
  }, DEFAULT_FLUSH_INTERVAL_MS)
  timer.unref?.()
}

/**
 * Best-effort remote transport for already-redacted server-side diagnostic events.
 * Never throws into the request path and never replaces stdout logging.
 */
export function enqueueAxiomLog(event: AxiomEvent) {
  if (!readAxiomConfig()) return
  queue.push({
    timestamp: new Date().toISOString(),
    service: "thread-chat",
    environment: process.env.AI_OBSERVABILITY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
    release: process.env.AI_OBSERVABILITY_RELEASE ?? "unknown",
    ...event,
  })
  if (queue.length >= DEFAULT_BATCH_SIZE) {
    void flushAxiomLogs()
    return
  }
  scheduleFlush()
}

export async function flushAxiomLogs(): Promise<void> {
  if (flushing) return flushing
  const config = readAxiomConfig()
  if (!config || queue.length === 0) return

  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }

  const batch = queue.splice(0, DEFAULT_BATCH_SIZE)
  flushing = (async () => {
    try {
      const response = await fetch(
        `${config.edgeUrl}/v1/ingest/${encodeURIComponent(config.dataset)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(batch),
        },
      )
      if (!response.ok) {
        console.error(AXIOM_LOG_PREFIX, JSON.stringify({
          event: "axiom.ingest_failed",
          httpStatus: response.status,
          batchSize: batch.length,
        }))
      }
    } catch (error) {
      console.error(AXIOM_LOG_PREFIX, JSON.stringify({
        event: "axiom.ingest_exception",
        batchSize: batch.length,
        errorType: error instanceof Error ? error.name : "unknown",
      }))
    } finally {
      flushing = undefined
      if (queue.length > 0) scheduleFlush()
    }
  })()

  return flushing
}
