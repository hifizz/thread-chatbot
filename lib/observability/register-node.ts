import type { Telemetry } from "ai"
import { resolveObservabilityConfig } from "@/lib/observability/config"
import { maskLangfuseExport } from "@/lib/observability/mask"

type EnvironmentSource = Record<string, string | undefined>

type RemoteHandle = {
  integration: Telemetry
  forceFlush: () => Promise<void>
  shutdown: () => Promise<void>
}

export type ObservabilityRuntime = {
  registerTelemetry: (...integrations: Telemetry[]) => void
  createDevtools: () => Promise<Telemetry>
  createLangfuse: (options: {
    publicKey: string
    secretKey: string
    baseUrl?: string
    environment: string
    release: string
  }) => Promise<RemoteHandle>
}

export type ObservabilityRegistrationResult = {
  status: "disabled" | "registered" | "degraded"
  devtools: "disabled" | "registered" | "failed"
  langfuse: "disabled" | "unconfigured" | "registered" | "failed"
}

type RegistrationState = {
  promise?: Promise<ObservabilityRegistrationResult>
  remote?: RemoteHandle
}

const STATE_KEY = Symbol.for("thread-chat.observability.registration.v1")

function state(): RegistrationState {
  const target = globalThis as typeof globalThis & {
    [STATE_KEY]?: RegistrationState
  }
  return (target[STATE_KEY] ??= {})
}

async function defaultRuntime(): Promise<ObservabilityRuntime> {
  const { registerTelemetry } = await import("ai")
  return {
    registerTelemetry,
    createDevtools: async () => {
      const { DevToolsTelemetry } = await import("@ai-sdk/devtools")
      return DevToolsTelemetry()
    },
    createLangfuse: async (options) => {
      const [otel, langfuseOtel, langfuseAiSdk] = await Promise.all([
        import("@opentelemetry/sdk-node"),
        import("@langfuse/otel"),
        import("@langfuse/vercel-ai-sdk"),
      ])
      const spanProcessor = new langfuseOtel.LangfuseSpanProcessor({
        publicKey: options.publicKey,
        secretKey: options.secretKey,
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        environment: options.environment,
        release: options.release,
        exportMode: "batched",
        mask: maskLangfuseExport,
      })
      const sdk = new otel.NodeSDK({ spanProcessors: [spanProcessor] })
      sdk.start()
      return {
        integration: new langfuseAiSdk.LangfuseVercelAiSdkIntegration(),
        forceFlush: () => spanProcessor.forceFlush(),
        shutdown: async () => {
          await sdk.shutdown()
        },
      }
    },
  }
}

async function initialize(
  source: EnvironmentSource,
  runtimeOverride?: ObservabilityRuntime
): Promise<ObservabilityRegistrationResult> {
  const config = resolveObservabilityConfig(source)
  if (!config.enabled) {
    return { status: "disabled", devtools: "disabled", langfuse: "disabled" }
  }

  const runtime = runtimeOverride ?? (await defaultRuntime())
  const integrations: Telemetry[] = []
  let devtools: ObservabilityRegistrationResult["devtools"] = "disabled"
  let langfuse: ObservabilityRegistrationResult["langfuse"] =
    config.langfuseConfigured ? "disabled" : "unconfigured"

  if (config.devtoolsEnabled) {
    try {
      integrations.push(await runtime.createDevtools())
      devtools = "registered"
    } catch (error) {
      devtools = "failed"
      console.warn(
        "[observability] AI SDK DevTools 初始化失败，继续使用摘要日志",
        error
      )
    }
  }

  if (
    config.langfuseEnabled &&
    config.langfusePublicKey &&
    config.langfuseSecretKey
  ) {
    try {
      const remote = await runtime.createLangfuse({
        publicKey: config.langfusePublicKey,
        secretKey: config.langfuseSecretKey,
        ...(config.langfuseBaseUrl ? { baseUrl: config.langfuseBaseUrl } : {}),
        environment: config.environment,
        release: config.release,
      })
      state().remote = remote
      integrations.push(remote.integration)
      langfuse = "registered"
    } catch (error) {
      langfuse = "failed"
      console.warn(
        "[observability] Langfuse 初始化失败，继续使用摘要日志",
        error
      )
    }
  }

  if (integrations.length > 0) runtime.registerTelemetry(...integrations)
  const degraded = devtools === "failed" || langfuse === "failed"
  return {
    status: degraded ? "degraded" : "registered",
    devtools,
    langfuse,
  }
}

export function registerNodeObservability(
  options: {
    source?: EnvironmentSource
    runtime?: ObservabilityRuntime
  } = {}
): Promise<ObservabilityRegistrationResult> {
  const registration = state()
  return (registration.promise ??= initialize(
    options.source ?? process.env,
    options.runtime
  ).catch((error) => {
    console.warn("[observability] 遥测注册失败，继续使用摘要日志", error)
    return {
      status: "degraded" as const,
      devtools: "failed" as const,
      langfuse: "failed" as const,
    }
  }))
}

export async function flushObservability(): Promise<void> {
  await state().remote?.forceFlush()
}

export async function resetObservabilityRegistrationForTests(): Promise<void> {
  const target = globalThis as typeof globalThis & {
    [STATE_KEY]?: RegistrationState
  }
  await target[STATE_KEY]?.remote?.shutdown()
  delete target[STATE_KEY]
}
