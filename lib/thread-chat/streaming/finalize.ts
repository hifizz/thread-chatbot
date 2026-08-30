import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { artifacts, messages } from "@/lib/db/schema"
import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { stripTransientParts } from "@/lib/thread-chat/application/command-utils"
import { toMessageDTO } from "@/lib/thread-chat/persistence/mappers"
import {
  collectFinalArtifacts,
  hasDisplayableParts,
} from "@/lib/thread-chat/streaming/artifacts"

export type RequestedTerminalStatus = "completed" | "stopped" | "failed"

export interface FinalizeGenerationInput {
  messageId: string
  snapshot: ThreadChatUIMessage
  status: RequestedTerminalStatus
  finishReason?: string
  providerUsage?: Record<string, unknown>
  error?: { code: string; message: string }
}

export async function finalizeGeneration({
  messageId,
  snapshot,
  status: requestedStatus,
  finishReason,
  providerUsage,
  error,
}: FinalizeGenerationInput): Promise<MessageDTO> {
  const parts = stripTransientParts(snapshot.parts)
  const empty = requestedStatus === "completed" && !hasDisplayableParts(parts)
  const status = empty ? "failed" : requestedStatus
  const resolvedError = empty
    ? { code: "EMPTY_RESPONSE", message: "模型没有返回可显示内容" }
    : status === "failed"
      ? (error ?? { code: "GENERATION_FAILED", message: "生成失败" })
      : null
  const finalArtifacts = collectFinalArtifacts(messageId, parts)

  return db.transaction(async (tx) => {
    const now = new Date()
    const [updated] = await tx
      .update(messages)
      .set({
        parts,
        status,
        finishReason: finishReason ?? null,
        providerUsage: providerUsage ?? null,
        errorCode: resolvedError?.code ?? null,
        errorMessage: resolvedError?.message ?? null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(messages.id, messageId), eq(messages.status, "generating")))
      .returning()

    if (!updated) {
      const [existing] = await tx
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1)
      if (!existing) throw new Error("MESSAGE_NOT_FOUND_DURING_FINALIZE")
      return toMessageDTO(existing)
    }

    if (finalArtifacts.length > 0) {
      await tx.insert(artifacts).values(
        finalArtifacts.map((artifact) => ({
          ...artifact,
          projectId: updated.projectId,
          threadId: updated.threadId,
          sourceMessageId: updated.id,
        }))
      )
    }
    return toMessageDTO(updated)
  })
}

export async function failOrphanedGeneratingMessage(
  messageId: string,
  code: "SESSION_LOST" | "PROCESS_RESTARTED" = "SESSION_LOST"
): Promise<MessageDTO | null> {
  const now = new Date()
  const [updated] = await db
    .update(messages)
    .set({
      status: "failed",
      errorCode: code,
      errorMessage:
        code === "PROCESS_RESTARTED"
          ? "服务进程重启，生成未能继续"
          : "生成会话已不可用",
      finishReason: "error",
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(eq(messages.id, messageId), eq(messages.status, "generating")))
    .returning()
  return updated ? toMessageDTO(updated) : null
}
