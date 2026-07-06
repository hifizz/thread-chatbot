import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { registerTelemetry } from "ai"
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk"
import { getLangfuseSpanProcessor, isLangfuseConfigured } from "./langfuse"

// 服务启动时（instrumentation.ts 的 register()）调用一次：
// 1. 注册 OTel TracerProvider，span 经 LangfuseSpanProcessor 批量发往 Langfuse
//    （processor 自带 smart filter，只导出 Langfuse/GenAI 相关 span）；
// 2. 注册 AI SDK v7 的全局遥测集成，此后所有 streamText/generateText/embed 调用
//    默认发出遥测事件，由 Langfuse 集成转为 generation/tool 观测。

declare global {
  var __observabilityRegistered: boolean | undefined
}

export function registerObservability() {
  if (!isLangfuseConfigured()) return
  // dev 下 instrumentation 可能随进程内重建再次执行；重复注册 provider 会告警且泄漏
  if (globalThis.__observabilityRegistered) return
  globalThis.__observabilityRegistered = true

  const provider = new NodeTracerProvider({
    spanProcessors: [getLangfuseSpanProcessor()],
  })
  provider.register()

  registerTelemetry(new LangfuseVercelAiSdkIntegration())
}
