import { eq, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { messages, projects } from "@/lib/db/schema"
import { emitProductEventDetached } from "@/lib/analytics/dispatch"
import { getSessionStore } from "@/lib/thread-chat/streaming/session-store"
import { TRACE_NAMES } from "@/constants/observability"
import { resolveObservabilityConfig } from "@/lib/observability/config"
import { resolveMessageTraceId } from "@/lib/observability/identity"
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
      traceId: messages.traceId,
      traceMappingVersion: messages.traceMappingVersion,
    })
  const config = resolveObservabilityConfig()
  const ownerRows =
    rows.length > 0
      ? await db
          .select({ id: projects.id, userId: projects.userId })
          .from(projects)
          .where(
            inArray(
              projects.id,
              [...new Set(rows.map((row) => row.projectId))]
            )
          )
      : []
  const ownerByProject = new Map(
    ownerRows.map((row) => [row.id, row.userId])
  )
  await Promise.all(
    rows.map(async (row) => {
      const ownerId = ownerByProject.get(row.projectId)
      if (ownerId) {
        emitProductEventDetached({
          name: "generation.failed",
          factId: row.id,
          userId: ownerId,
          payload: { generationId: row.id, errorCode: "PROCESS_RESTARTED" },
        })
      }
      const trace = await resolveMessageTraceId(row)
      await runAgentTrace(
        {
          name: TRACE_NAMES.threadChatGeneration,
          traceId: trace.traceId,
          sessionId: row.threadId,
          tags: ["thread-chat", "reconciliation"],
          context: {
            projectId: row.projectId,
            threadId: row.threadId,
            assistantMessageId: row.id,
            generationId: row.id,
            traceMappingVersion: trace.traceMappingVersion,
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
