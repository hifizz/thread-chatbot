import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { messages } from "@/lib/db/schema"
import { getSessionStore } from "@/lib/thread-chat/streaming/session-store"

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
    .returning({ id: messages.id })
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
