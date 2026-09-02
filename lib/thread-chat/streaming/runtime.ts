import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { messages } from "@/lib/db/schema"
import { getSessionStore } from "@/lib/thread-chat/streaming/session-store"
import { TRACE_NAMES } from "@/constants/observability"
import { resolveObservabilityConfig } from "@/lib/observability/config"
import { assistantMessageTraceId } from "@/lib/observability/identity"
import { runAgentTrace } from "@/lib/observability/trace"

async function sweepInterruptedGenerations(): Promise<number> {
  const now = new Date()
  const rows = await db
    .update(messages)
    .set({
      status: "failed",
      errorCode: "PROCESS_RESTARTED",
      errorMessage: "服务进程重启，生成未能继续",
      finishReason: "error",
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(messages.status, "generating"))
    .returning({
      id: messages.id,
      projectId: messages.projectId,
      threadId: messages.threadId,
      modelId: messages.modelId,
    })
  const config = resolveObservabilityConfig()
  await Promise.all(
    rows.map(async (row) => {
      await runAgentTrace(
        {
          name: TRACE_NAMES.threadChatGeneration,
          traceId: await assistantMessageTraceId(row.id),
          sessionId: row.projectId,
          tags: ["thread-chat", "reconciliation"],
          context: {
            projectId: row.projectId,
            threadId: row.threadId,
            assistantMessageId: row.id,
            ...(row.modelId ? { modelId: row.modelId } : {}),
            environment: config.environment,
            release: config.release,
            entrypoint: "thread-chat-reconciliation",
          },
        },
        async (observation) => {
          observation.update({
            level: "ERROR",
            statusMessage: "generation abandoned after process restart",
            output: {
              status: "failed",
              finishReason: "error",
              errorCode: "PROCESS_RESTARTED",
            },
          })
        }
      ).catch((error) => {
        console.warn(
          `[thread-chat] orphan Message ${row.id} 遥测记录失败，数据库终态已提交`,
          error
        )
      })
    })
  )
  return rows.length
}

const RUNTIME_PROMISE_SYMBOL = Symbol.for("thread-chat.v1.runtime-init")
type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_PROMISE_SYMBOL]?: Promise<void>
}

export function ensureThreadChatRuntimeInitialized(): Promise<void> {
  const scope = globalThis as RuntimeGlobal
  scope[RUNTIME_PROMISE_SYMBOL] ??= (async () => {
    getSessionStore()
    await sweepInterruptedGenerations()
  })()
  return scope[RUNTIME_PROMISE_SYMBOL]
}

export { sweepInterruptedGenerations }
