import {
  propagateAttributes,
  startActiveObservation,
  type LangfuseObservation,
  type LangfuseSpanAttributes,
} from "@langfuse/tracing"
import { TRACE_NAMES } from "@/constants/observability"
import { safeErrorMetadata } from "@/lib/observability/error"
import type { ObservabilityContext } from "@/lib/observability/types"
import { buildObservabilityRuntimeContext } from "@/lib/observability/ai-sdk"

export type AppObservationAttributes = LangfuseSpanAttributes

export type AppObservation = {
  readonly id: string
  readonly traceId: string
  update: (attributes: AppObservationAttributes) => void
  end: () => void
}

export type AgentTraceInput = {
  name: (typeof TRACE_NAMES)[keyof typeof TRACE_NAMES]
  traceId: string
  context: ObservabilityContext
  sessionId?: string
  tags?: string[]
}

export type AgentTraceBackend = {
  runRoot<T>(input: AgentTraceInput, fn: (observation: AppObservation) => T): T
  observe<T>(
    name: string,
    attributes: AppObservationAttributes,
    fn: (observation: AppObservation) => T
  ): T
}

function observationAdapter(observation: LangfuseObservation): AppObservation {
  return {
    id: observation.id,
    traceId: observation.traceId,
    update: (attributes) => {
      observation.updateOtelSpanAttributes(attributes)
    },
    end: () => observation.end(),
  }
}

function noOpObservation(traceId = "00000000000000000000000000000000") {
  return {
    id: "0000000000000000",
    traceId,
    update: () => {},
    end: () => {},
  } satisfies AppObservation
}

const defaultBackend: AgentTraceBackend = {
  runRoot(input, fn) {
    const metadata = Object.fromEntries(
      Object.entries(buildObservabilityRuntimeContext(input.context)).map(
        ([key, value]) => [key, String(value)]
      )
    )
    let callbackStarted = false
    try {
      return startActiveObservation(
        input.name,
        (observation) => {
          callbackStarted = true
          return propagateAttributes(
            {
              ...(input.context.pseudonymousUserId
                ? { userId: String(input.context.pseudonymousUserId) }
                : {}),
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
              ...(input.context.environment
                ? { environment: String(input.context.environment) }
                : {}),
              ...(input.context.release
                ? { version: String(input.context.release) }
                : {}),
              traceName: input.name,
              metadata,
              tags: input.tags,
            },
            () => fn(observationAdapter(observation))
          )
        },
        {
          asType: "agent",
          endOnExit: false,
          parentSpanContext: {
            traceId: input.traceId,
            spanId: input.traceId.slice(16),
            traceFlags: 1,
          },
        }
      )
    } catch (error) {
      if (callbackStarted) throw error
      console.warn(
        "[observability] 根 Trace 创建失败，继续执行 Agent 工作流",
        error
      )
      return fn(noOpObservation(input.traceId))
    }
  },
  observe(name, attributes, fn) {
    let callbackStarted = false
    try {
      return startActiveObservation(
        name,
        (observation) => {
          callbackStarted = true
          const adapted = observationAdapter(observation)
          adapted.update(attributes)
          return fn(adapted)
        },
        { endOnExit: true }
      )
    } catch (error) {
      if (callbackStarted) throw error
      console.warn(
        `[observability] Observation ${name} 创建失败，继续执行应用操作`,
        error
      )
      return fn(noOpObservation())
    }
  },
}

const BACKEND_KEY = Symbol.for("thread-chat.observability.trace-backend.v1")
type BackendScope = typeof globalThis & {
  [BACKEND_KEY]?: AgentTraceBackend
}

export function getAgentTraceBackend(): AgentTraceBackend {
  return (globalThis as BackendScope)[BACKEND_KEY] ?? defaultBackend
}

export function setAgentTraceBackendForTests(
  backend: AgentTraceBackend | null
): void {
  const scope = globalThis as BackendScope
  if (backend) scope[BACKEND_KEY] = backend
  else delete scope[BACKEND_KEY]
}

export async function runAgentTrace<T>(
  input: AgentTraceInput,
  fn: (observation: AppObservation) => Promise<T>
): Promise<T> {
  return getAgentTraceBackend().runRoot(input, async (observation) => {
    try {
      return await fn(observation)
    } catch (error) {
      observation.update({
        level: "ERROR",
        statusMessage: "agent trace failed",
        metadata: safeErrorMetadata(error),
      })
      throw error
    } finally {
      observation.end()
    }
  })
}

/** legacy streaming route 由 server-owned after callback 手动结束。 */
export function runDetachedAgentTrace<T>(
  input: AgentTraceInput,
  fn: (observation: AppObservation) => T
): T {
  return getAgentTraceBackend().runRoot(input, fn)
}

export async function observeAppOperation<T>(
  name: string,
  attributes: AppObservationAttributes,
  fn: (observation: AppObservation) => Promise<T>
): Promise<T> {
  const startedAt = performance.now()
  let metadata = { ...attributes.metadata }
  return getAgentTraceBackend().observe(
    name,
    attributes,
    async (observation) => {
      const mergedObservation: AppObservation = {
        ...observation,
        update(update) {
          if (update.metadata) {
            metadata = { ...metadata, ...update.metadata }
          }
          observation.update({
            ...update,
            ...(update.metadata ? { metadata } : {}),
          })
        },
      }
      try {
        const result = await fn(mergedObservation)
        mergedObservation.update({
          metadata: {
            operationOutcome: "success",
            operationDurationMs: Math.round(performance.now() - startedAt),
          },
        })
        return result
      } catch (error) {
        mergedObservation.update({
          level: "ERROR",
          statusMessage: "operation failed",
          metadata: {
            ...safeErrorMetadata(error),
            operationOutcome: "error",
            operationDurationMs: Math.round(performance.now() - startedAt),
          },
        })
        throw error
      }
    }
  )
}
