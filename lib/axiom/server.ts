type LogLevel = "debug" | "info" | "warn" | "error"
type LogFields = Record<string, unknown>

type AxiomConfig = {
  token: string
  dataset: string
  edgeUrl: string
}

type ServerLogEvent = {
  _time: string
  level: LogLevel
  message: string
  source: "server-log"
  service: string
  environment: string
  release: string
  fields: LogFields
}

const BATCH_SIZE = 25
const FLUSH_INTERVAL_MS = 250
const SERVICE_NAME = "thread-chat"

let queue: ServerLogEvent[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let flushing: Promise<void> | undefined

function readConfig(source: NodeJS.ProcessEnv = process.env): AxiomConfig | undefined {
  const token = source.AXIOM_TOKEN?.trim()
  const dataset = source.AXIOM_DATASET?.trim()
  const edgeUrl = source.AXIOM_EDGE_URL?.trim().replace(/\/$/, "")
  if (!token || !dataset || !edgeUrl) return undefined
  return { token, dataset, edgeUrl }
}

function writeStdout(event: ServerLogEvent) {
  const line = JSON.stringify(event)
  if (event.level === "error") console.error(line)
  else if (event.level === "warn") console.warn(line)
  else if (event.level === "debug") console.debug(line)
  else console.info(line)
}

function scheduleFlush() {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    void flush()
  }, FLUSH_INTERVAL_MS)
  timer.unref?.()
}

function enqueue(event: ServerLogEvent) {
  if (!readConfig()) return
  queue.push(event)
  if (queue.length >= BATCH_SIZE) void flush()
  else scheduleFlush()
}

function createEvent(level: LogLevel, message: string, fields: LogFields): ServerLogEvent {
  return {
    _time: new Date().toISOString(),
    level,
    message,
    source: "server-log",
    service: SERVICE_NAME,
    environment: process.env.AI_OBSERVABILITY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
    release: process.env.AI_OBSERVABILITY_RELEASE ?? "unknown",
    fields,
  }
}

function write(level: LogLevel, message: string, fields: LogFields = {}) {
  const event = createEvent(level, message, fields)
  writeStdout(event)
  enqueue(event)
}

export function axiomConfigured(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(readConfig(source))
}

export async function flush(): Promise<void> {
  if (flushing) return flushing
  const config = readConfig()
  if (!config || queue.length === 0) return

  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }

  const batch = queue.splice(0, BATCH_SIZE)
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
        }
      )
      if (!response.ok) {
        console.error(
          JSON.stringify({
            _time: new Date().toISOString(),
            level: "error",
            message: "axiom.ingest_failed",
            source: "server-log",
            service: SERVICE_NAME,
            environment: process.env.AI_OBSERVABILITY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
            release: process.env.AI_OBSERVABILITY_RELEASE ?? "unknown",
            fields: { httpStatus: response.status, batchSize: batch.length },
          })
        )
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          _time: new Date().toISOString(),
          level: "error",
          message: "axiom.ingest_exception",
          source: "server-log",
          service: SERVICE_NAME,
          environment: process.env.AI_OBSERVABILITY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
          release: process.env.AI_OBSERVABILITY_RELEASE ?? "unknown",
          fields: {
            batchSize: batch.length,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
        })
      )
    } finally {
      flushing = undefined
      if (queue.length > 0) scheduleFlush()
    }
  })()

  return flushing
}

function withFields(context: LogFields) {
  return {
    debug(message: string, fields: LogFields = {}) {
      write("debug", message, { ...context, ...fields })
    },
    info(message: string, fields: LogFields = {}) {
      write("info", message, { ...context, ...fields })
    },
    warn(message: string, fields: LogFields = {}) {
      write("warn", message, { ...context, ...fields })
    },
    error(message: string, fields: LogFields = {}) {
      write("error", message, { ...context, ...fields })
    },
    flush,
    with: (fields: LogFields) => withFields({ ...context, ...fields }),
  }
}

export const logger = withFields({})
