import { createHash } from "node:crypto"
import { getActiveSpanId, getActiveTraceId } from "@langfuse/tracing"
import { OBSERVATION_NAMES } from "@/constants/observability"
import { classifyObservabilityError } from "@/lib/observability/error"
import { observeAppOperation } from "@/lib/observability/trace"

export type ProviderAttemptOperation = "search" | "fetch" | "extract"
export type ProviderAttemptOutcome =
  | "success"
  | "empty"
  | "unusable"
  | "cancelled"
  | "timeout"
  | "rate_limit"
  | "authentication"
  | "provider_error"
  | "budget_exhausted"
  | "unknown_error"

export type ProviderUsage = {
  unit: "request" | "credit" | "page" | "retrieval" | "task-run"
  quantity: number
  estimated: boolean
}

export type ProviderAttemptInput = {
  provider: string
  operation: ProviderAttemptOperation
  routeReason?: string
  attemptIndex?: number
  fallbackCount?: number
  query?: string
  url?: string
  usage?: ProviderUsage
}

export type ProviderAttemptResultSummary = {
  outcome: "success" | "empty" | "unusable"
  resultCount?: number
  responseCharacters?: number
}

export type ProviderAttemptEvent = {
  phase: "start" | "finish"
  attemptId: string
  traceId?: string
  parentObservationId?: string
  provider: string
  operation: ProviderAttemptOperation
  routeReason: string
  attemptIndex: number
  fallbackCount: number
  outcome: "running" | ProviderAttemptOutcome
  durationMs?: number
  usageUnit?: ProviderUsage["unit"]
  usageQuantity?: number
  usageEstimated?: boolean
  queryFingerprint?: string
  domain?: string
  resultCount?: number
  responseCharacters?: number
  errorCategory?: string
}

type ProviderAttemptEventConsumer = (event: ProviderAttemptEvent) => void

const CONSUMER_KEY = Symbol.for(
  "thread-chat.observability.provider-attempt-consumer.v1"
)
type ConsumerScope = typeof globalThis & {
  [CONSUMER_KEY]?: ProviderAttemptEventConsumer
}

export function fingerprintProviderQuery(query: string): string {
  return createHash("sha256")
    .update(query.trim().replace(/\s+/g, " ").toLowerCase())
    .digest("hex")
}

export function providerUrlDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

function eventConsumer(): ProviderAttemptEventConsumer {
  return (
    (globalThis as ConsumerScope)[CONSUMER_KEY] ??
    ((event) => {
      if (process.env.NODE_ENV !== "development") return
      console.info(
        `[provider-attempt] provider=${event.provider} operation=${event.operation} phase=${event.phase} outcome=${event.outcome} attempt=${event.attemptIndex} fallback=${event.fallbackCount}`
      )
    })
  )
}

export function setProviderAttemptEventConsumerForTests(
  consumer: ProviderAttemptEventConsumer | null
): void {
  const scope = globalThis as ConsumerScope
  if (consumer) scope[CONSUMER_KEY] = consumer
  else delete scope[CONSUMER_KEY]
}

function baseEvent(
  input: ProviderAttemptInput
): Omit<ProviderAttemptEvent, "phase" | "outcome"> {
  return {
    attemptId: crypto.randomUUID(),
    ...(getActiveTraceId() ? { traceId: getActiveTraceId() } : {}),
    ...(getActiveSpanId() ? { parentObservationId: getActiveSpanId() } : {}),
    provider: input.provider,
    operation: input.operation,
    routeReason: input.routeReason ?? "unspecified",
    attemptIndex: input.attemptIndex ?? 0,
    fallbackCount: input.fallbackCount ?? 0,
    ...(input.usage
      ? {
          usageUnit: input.usage.unit,
          usageQuantity: input.usage.quantity,
          usageEstimated: input.usage.estimated,
        }
      : {}),
    ...(input.query
      ? { queryFingerprint: fingerprintProviderQuery(input.query) }
      : {}),
    ...(input.url && providerUrlDomain(input.url)
      ? { domain: providerUrlDomain(input.url) }
      : {}),
  }
}

function errorOutcome(error: unknown): ProviderAttemptOutcome {
  if (typeof error === "object" && error !== null) {
    const code = String(
      (error as Record<string, unknown>).code ?? ""
    ).toLowerCase()
    if (code.includes("budget")) return "budget_exhausted"
    if (code.includes("empty")) return "empty"
    if (code.includes("unusable")) return "unusable"
  }
  switch (classifyObservabilityError(error)) {
    case "abort":
      return "cancelled"
    case "timeout":
      return "timeout"
    case "rate_limit":
      return "rate_limit"
    case "authentication":
      return "authentication"
    case "provider":
      return "provider_error"
    default:
      return "unknown_error"
  }
}

function eventAttributes(event: ProviderAttemptEvent) {
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined)
  )
}

/**
 * 所有 Web provider adapter 的统一调用边界。事件只含 fingerprint/domain 和计量摘要，
 * 不接受 request headers、query/URL 原文、正文或 provider payload。
 */
export async function runProviderAttempt<T>(
  input: ProviderAttemptInput,
  execute: () => Promise<T>,
  summarize: (result: T) => ProviderAttemptResultSummary
): Promise<T> {
  const startedAt = performance.now()
  const base = baseEvent(input)
  const startEvent: ProviderAttemptEvent = {
    ...base,
    phase: "start",
    outcome: "running",
  }
  eventConsumer()(startEvent)

  return observeAppOperation(
    `${OBSERVATION_NAMES.searchProviderAttempt}.${input.provider.toLowerCase()}.${input.operation}`,
    { metadata: eventAttributes(startEvent) },
    async (observation) => {
      try {
        const result = await execute()
        const summary = summarize(result)
        const finishEvent: ProviderAttemptEvent = {
          ...base,
          phase: "finish",
          durationMs: Math.round(performance.now() - startedAt),
          ...summary,
        }
        eventConsumer()(finishEvent)
        observation.update({
          output: {
            outcome: finishEvent.outcome,
            resultCount: finishEvent.resultCount,
            responseCharacters: finishEvent.responseCharacters,
          },
          metadata: eventAttributes(finishEvent),
        })
        return result
      } catch (error) {
        const outcome = errorOutcome(error)
        const finishEvent: ProviderAttemptEvent = {
          ...base,
          phase: "finish",
          outcome,
          durationMs: Math.round(performance.now() - startedAt),
          errorCategory: classifyObservabilityError(error),
        }
        eventConsumer()(finishEvent)
        observation.update({
          level: outcome === "cancelled" ? "DEFAULT" : "ERROR",
          statusMessage: `provider attempt ${outcome}`,
          output: { outcome },
          metadata: eventAttributes(finishEvent),
        })
        throw error
      }
    }
  )
}
