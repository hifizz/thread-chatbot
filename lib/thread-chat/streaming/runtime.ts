import { and, eq, isNull, lt, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { messages } from "@/lib/db/schema"
import { getSessionStore } from "@/lib/thread-chat/streaming/session-store"
import { heartbeatStaleBefore } from "@/lib/thread-chat/streaming/generation-ownership"
import { TRACE_NAMES } from "@/constants/observability"
import { THREAD_CHAT_ORPHAN_SWEEP_INTERVAL_MS } from "@/constants/thread-chat-stream"
import { resolveObservabilityConfig } from "@/lib/observability/config"
import { assistantMessageTraceId } from "@/lib/observability/identity"
import { runAgentTrace } from "@/lib/observability/trace"

/**
 * 孤儿生成清扫：只处理属主心跳已过期、或从未被认领且停留过久的 generating 行。
 * 多实例下绝不能按「本进程刚重启」推断他人生成已死——活实例的心跳必须让行免于清扫。
 */
async function sweepInterruptedGenerations(now: Date = new Date()): Promise<number> {
  const staleBefore = heartbeatStaleBefore(now)
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
    .where(
      and(
        eq(messages.status, "generating"),
        or(
          lt(messages.generationHeartbeatAt, staleBefore),
          and(
            isNull(messages.generationHeartbeatAt),
            lt(messages.updatedAt, staleBefore)
          )
        )
      )
    )
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
const SWEEP_TIMER_SYMBOL = Symbol.for("thread-chat.v1.orphan-sweep-timer")
type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_PROMISE_SYMBOL]?: Promise<void>
  [SWEEP_TIMER_SYMBOL]?: ReturnType<typeof setInterval>
}

export function ensureThreadChatRuntimeInitialized(): Promise<void> {
  const scope = globalThis as RuntimeGlobal
  scope[RUNTIME_PROMISE_SYMBOL] ??= (async () => {
    getSessionStore()
    await sweepInterruptedGenerations()
    // 周期性清扫：捕获「属主实例崩溃但本进程未重启」的孤儿生成。
    // 谓词只看心跳过期，绝不会误杀其他活实例的工作。
    if (!scope[SWEEP_TIMER_SYMBOL]) {
      scope[SWEEP_TIMER_SYMBOL] = setInterval(() => {
        void sweepInterruptedGenerations().catch((error) =>
          console.warn("[thread-chat] 周期孤儿清扫失败:", error)
        )
      }, THREAD_CHAT_ORPHAN_SWEEP_INTERVAL_MS)
      scope[SWEEP_TIMER_SYMBOL].unref?.()
    }
  })()
  return scope[RUNTIME_PROMISE_SYMBOL]
}

export { sweepInterruptedGenerations }
