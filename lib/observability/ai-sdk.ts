import type { TelemetryOptions } from "ai"
import {
  OBSERVABILITY_ATTRIBUTE_KEYS,
  type ObservabilityAttributeKey,
} from "@/constants/observability"
import type { ModelCallPurpose } from "@/constants/model-call"
import {
  resolveObservabilityConfig,
  resolveTelemetryContentPolicy,
} from "@/lib/observability/config"
import type {
  ObservabilityAttributeValue,
  ObservabilityContext,
} from "@/lib/observability/types"

export type AiRuntimeContext = Partial<
  Record<ObservabilityAttributeKey, ObservabilityAttributeValue>
>

export function buildObservabilityRuntimeContext(
  context: ObservabilityContext = {}
): AiRuntimeContext {
  const config = resolveObservabilityConfig()
  const candidates: ObservabilityContext = {
    ...context,
    environment: config.environment,
    release: config.release,
  }
  return Object.fromEntries(
    OBSERVABILITY_ATTRIBUTE_KEYS.flatMap((key) => {
      const value = candidates[key]
      return value === undefined ? [] : [[key, value]]
    })
  ) as AiRuntimeContext
}

export function buildAiTelemetryOptions(
  purpose: ModelCallPurpose,
  context: ObservabilityContext = {}
): TelemetryOptions<AiRuntimeContext> {
  const policy = resolveTelemetryContentPolicy({
    allowContentCapture: context.allowContentCapture,
  })
  const runtimeContext = buildObservabilityRuntimeContext(context)
  const includeRuntimeContext = Object.fromEntries(
    Object.keys(runtimeContext).map((key) => [key, true])
  ) as Record<keyof AiRuntimeContext, true>

  return {
    isEnabled: policy.enabled,
    functionId: purpose,
    recordInputs: policy.recordInputs,
    recordOutputs: policy.recordOutputs,
    includeRuntimeContext,
  }
}

/** 文本生成调用同时需要 runtimeContext；embedding 只使用 telemetry 字段。 */
export function buildAiTelemetryConfig(
  purpose: ModelCallPurpose,
  context: ObservabilityContext = {}
) {
  const runtimeContext = buildObservabilityRuntimeContext(context)
  return {
    runtimeContext,
    telemetry: buildAiTelemetryOptions(purpose, context),
  }
}
