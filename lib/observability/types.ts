import type {
  ObservabilityAttributeKey,
  ObservabilityEnvironment,
} from "@/constants/observability"

export type ObservabilityAttributeValue = string | number | boolean

export type ObservabilityContext = Partial<
  Record<ObservabilityAttributeKey, ObservabilityAttributeValue>
> & {
  /** 只作为本次调用的策略输入，不会进入 exporter。 */
  allowContentCapture?: boolean
}

export type ModelCallTrace = Pick<
  ObservabilityContext,
  | "requestId"
  | "treeId"
  | "threadId"
  | "generationId"
  | "assistantMessageId"
  | "projectId"
  | "pseudonymousUserId"
>

export type TelemetryContentPolicy = {
  enabled: boolean
  recordInputs: boolean
  recordOutputs: boolean
  reason:
    | "disabled"
    | "metadata-only"
    | "development"
    | "evaluation"
    | "staging"
    | "production-cohort"
}

export type ObservabilityConfig = {
  enabled: boolean
  environment: ObservabilityEnvironment
  release: string
  devtoolsEnabled: boolean
  langfuseEnabled: boolean
  langfuseConfigured: boolean
  langfusePublicKey?: string
  langfuseSecretKey?: string
  langfuseBaseUrl?: string
  idSalt?: string
}
