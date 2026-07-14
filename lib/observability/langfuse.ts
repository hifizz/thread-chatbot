import { LangfuseSpanProcessor } from "@langfuse/otel"
import { LangfuseClient } from "@langfuse/client"

// Langfuse 可观测后端的共享单例。
// 未配置 LANGFUSE_* 时，各入口应先判 isLangfuseConfigured() 并整体跳过，
// 让遥测零开销降级（与 R2/embeddings/search 的可选降级惯例一致）。
//
// instrumentation.ts（注册 span processor）与 route handler（响应后 forceFlush）
// 在 Next.js 里属于不同的编译产物，模块级变量不互通，因此单例挂在 globalThis 上；
// 这同时避免了 dev HMR 重复实例化。

declare global {
  var __langfuseSpanProcessor: LangfuseSpanProcessor | undefined
  var __langfuseClient: LangfuseClient | undefined
}

export function isLangfuseConfigured() {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
  )
}

/** span 上报通道（batched）。密钥/地址走 LANGFUSE_* 环境变量。 */
export function getLangfuseSpanProcessor(): LangfuseSpanProcessor {
  globalThis.__langfuseSpanProcessor ??= new LangfuseSpanProcessor()
  return globalThis.__langfuseSpanProcessor
}

/** REST 客户端：score 上报、datasets/experiments 用 */
export function getLangfuseClient(): LangfuseClient {
  globalThis.__langfuseClient ??= new LangfuseClient()
  return globalThis.__langfuseClient
}

/**
 * 冲刷待发送的 span 批次。serverless 部署（Vercel 等）中函数在响应后可能立刻冻结，
 * 必须在 next/server 的 after() 里调用；本地长驻 dev 进程调用无害。
 * 导出失败只损失遥测数据，SDK 自会记日志，不向上抛（避免 after() 里刷未处理错误）。
 */
export async function flushLangfuseSpans() {
  if (!globalThis.__langfuseSpanProcessor) return
  await globalThis.__langfuseSpanProcessor.forceFlush().catch(() => {})
}

/**
 * 服务端下发的 assistant 消息 id 就是 W3C traceId（32 位小写 hex），反馈打分靠它回写。
 * 全零是 OTel 的 INVALID_TRACEID（无 TracerProvider 时 no-op span 会给出），必须排除。
 */
export function isValidTraceId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id) && id !== "00000000000000000000000000000000"
}
