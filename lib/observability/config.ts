import {
  DEFAULT_OBSERVABILITY_RELEASE,
  OBSERVABILITY_ENVIRONMENTS,
  type ObservabilityEnvironment,
} from "@/constants/observability"
import type {
  ObservabilityConfig,
  TelemetryContentPolicy,
} from "@/lib/observability/types"

type EnvironmentSource = Record<string, string | undefined>

function isEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue
  return !["0", "false", "off", "no"].includes(value.toLowerCase())
}

function resolveEnvironment(
  source: EnvironmentSource
): ObservabilityEnvironment {
  const configured = source.AI_OBSERVABILITY_ENVIRONMENT
  if (
    configured &&
    Object.values(OBSERVABILITY_ENVIRONMENTS).includes(
      configured as ObservabilityEnvironment
    )
  ) {
    return configured as ObservabilityEnvironment
  }
  if (source.NODE_ENV === "test") return OBSERVABILITY_ENVIRONMENTS.test
  if (source.NODE_ENV === "production")
    return OBSERVABILITY_ENVIRONMENTS.production
  return OBSERVABILITY_ENVIRONMENTS.development
}

export function resolveObservabilityConfig(
  source: EnvironmentSource = process.env
): ObservabilityConfig {
  const environment = resolveEnvironment(source)
  const enabled = isEnabled(
    source.AI_TELEMETRY_ENABLED,
    environment !== OBSERVABILITY_ENVIRONMENTS.test
  )
  const langfuseConfigured = Boolean(
    source.LANGFUSE_PUBLIC_KEY && source.LANGFUSE_SECRET_KEY
  )
  const allowLocalRemoteExport = isEnabled(
    source.AI_LANGFUSE_ENABLED,
    environment !== OBSERVABILITY_ENVIRONMENTS.development
  )

  return {
    enabled,
    environment,
    release:
      source.AI_OBSERVABILITY_RELEASE?.trim() || DEFAULT_OBSERVABILITY_RELEASE,
    devtoolsEnabled:
      enabled &&
      source.NODE_ENV !== "production" &&
      environment === OBSERVABILITY_ENVIRONMENTS.development &&
      isEnabled(source.AI_DEVTOOLS_ENABLED, true),
    langfuseEnabled: enabled && langfuseConfigured && allowLocalRemoteExport,
    langfuseConfigured,
    ...(source.LANGFUSE_PUBLIC_KEY
      ? { langfusePublicKey: source.LANGFUSE_PUBLIC_KEY }
      : {}),
    ...(source.LANGFUSE_SECRET_KEY
      ? { langfuseSecretKey: source.LANGFUSE_SECRET_KEY }
      : {}),
    ...(source.LANGFUSE_BASE_URL
      ? { langfuseBaseUrl: source.LANGFUSE_BASE_URL }
      : {}),
    ...(source.AI_OBSERVABILITY_ID_SALT
      ? { idSalt: source.AI_OBSERVABILITY_ID_SALT }
      : {}),
  }
}

export function resolveTelemetryContentPolicy({
  source = process.env,
  allowContentCapture = false,
}: {
  source?: EnvironmentSource
  allowContentCapture?: boolean
} = {}): TelemetryContentPolicy {
  const config = resolveObservabilityConfig(source)
  if (!config.enabled) {
    return {
      enabled: false,
      recordInputs: false,
      recordOutputs: false,
      reason: "disabled",
    }
  }

  const requested = isEnabled(
    source.AI_TELEMETRY_RECORD_CONTENT,
    config.environment === OBSERVABILITY_ENVIRONMENTS.development
  )
  if (!requested) {
    return {
      enabled: true,
      recordInputs: false,
      recordOutputs: false,
      reason: "metadata-only",
    }
  }

  const reason =
    config.environment === OBSERVABILITY_ENVIRONMENTS.development
      ? "development"
      : config.environment === OBSERVABILITY_ENVIRONMENTS.evaluation
        ? "evaluation"
        : config.environment === OBSERVABILITY_ENVIRONMENTS.staging
          ? "staging"
          : config.environment === OBSERVABILITY_ENVIRONMENTS.production &&
              allowContentCapture
            ? "production-cohort"
            : null

  return reason
    ? { enabled: true, recordInputs: true, recordOutputs: true, reason }
    : {
        enabled: true,
        recordInputs: false,
        recordOutputs: false,
        reason: "metadata-only",
      }
}
