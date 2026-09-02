import { OBSERVABILITY_ENVIRONMENTS } from "@/constants/observability"
import {
  resolveObservabilityConfig,
  resolveTelemetryContentPolicy,
} from "@/lib/observability/config"

type EnvironmentSource = Record<string, string | undefined>

export type ReleaseReadinessCheck = {
  id: string
  status: "pass" | "warning" | "fail"
  message: string
}

export type ReleaseReadinessReport = {
  ready: boolean
  environment: string
  release: string
  endpointOrigin: string | null
  metadataOnly: boolean
  checks: ReleaseReadinessCheck[]
}

function endpointOrigin(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function evaluateObservabilityReleaseReadiness(
  source: EnvironmentSource = process.env
): ReleaseReadinessReport {
  const config = resolveObservabilityConfig(source)
  const content = resolveTelemetryContentPolicy({ source })
  const origin = endpointOrigin(source.LANGFUSE_BASE_URL)
  const remoteEnvironment =
    config.environment === OBSERVABILITY_ENVIRONMENTS.staging ||
    config.environment === OBSERVABILITY_ENVIRONMENTS.production
  const checks: ReleaseReadinessCheck[] = [
    {
      id: "remote-environment",
      status: remoteEnvironment ? "pass" : "fail",
      message: remoteEnvironment
        ? "environment is isolated from local development"
        : "set AI_OBSERVABILITY_ENVIRONMENT to staging or production",
    },
    {
      id: "telemetry-enabled",
      status: config.enabled ? "pass" : "warning",
      message: config.enabled
        ? "telemetry is enabled"
        : "telemetry is disabled; this is safe but no remote evidence will arrive",
    },
    {
      id: "credentials",
      status: config.langfuseConfigured ? "pass" : "fail",
      message: config.langfuseConfigured
        ? "both server-side Langfuse credentials are present"
        : "both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required",
    },
    {
      id: "remote-export",
      status: config.langfuseEnabled ? "pass" : "warning",
      message: config.langfuseEnabled
        ? "remote export is enabled"
        : "remote export is disabled; use this state for the initial safe deploy",
    },
    {
      id: "metadata-only",
      status: !content.recordInputs && !content.recordOutputs ? "pass" : "fail",
      message:
        !content.recordInputs && !content.recordOutputs
          ? "prompt and output content capture is disabled"
          : "staging/production rollout must start with metadata-only telemetry",
    },
    {
      id: "devtools-disabled",
      status: !config.devtoolsEnabled ? "pass" : "fail",
      message: !config.devtoolsEnabled
        ? "AI SDK DevTools is disabled"
        : "AI SDK DevTools must never run in the deployed service",
    },
    {
      id: "anonymous-user-salt",
      status: config.idSalt ? "pass" : "fail",
      message: config.idSalt
        ? "pseudonymous user ID salt is configured"
        : "AI_OBSERVABILITY_ID_SALT is required for deployed traces",
    },
    {
      id: "release",
      status: config.release !== "local" ? "pass" : "fail",
      message:
        config.release !== "local"
          ? "release identifier is explicit"
          : "AI_OBSERVABILITY_RELEASE must identify the deployment",
    },
    {
      id: "endpoint",
      status: origin && new URL(origin).protocol === "https:" ? "pass" : "fail",
      message:
        origin && new URL(origin).protocol === "https:"
          ? "Langfuse endpoint is a valid HTTPS origin"
          : "LANGFUSE_BASE_URL must be an explicit HTTPS Cloud or OSS endpoint",
    },
  ]

  return {
    ready: checks.every((check) => check.status !== "fail"),
    environment: config.environment,
    release: config.release,
    endpointOrigin: origin,
    metadataOnly: !content.recordInputs && !content.recordOutputs,
    checks,
  }
}
