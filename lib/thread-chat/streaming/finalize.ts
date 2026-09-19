import { lockDocumentExecution } from "../persistence/documents/commands"
import { registerDocumentArtifact } from "../persistence/documents/writes"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { artifacts, messages, projects } from "@/lib/db/schema"
import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { stripTransientParts } from "@/lib/thread-chat/application/command-utils"
import { toMessageDTO } from "@/lib/thread-chat/persistence/mappers"
import {
  artifactCallStats,
  collectFinalArtifacts,
  hasDisplayableParts,
} from "@/lib/thread-chat/streaming/artifacts"
import { AI_DIAGNOSTIC_EVENTS } from "@/constants/observability"
import { logDiagnostic } from "@/lib/observability/diagnostic-log"

export type RequestedTerminalStatus = "completed" | "stopped" | "failed"

/**
 * 流中断时最后一个工具调用可能停在 input-streaming/input-available，
 * 持久化前修成 output-error，避免 UI 永久 loading、快照里留下假“进行中”状态。
 */
function repairInterruptedToolParts(
  parts: ThreadChatUIMessage["parts"]
): ThreadChatUIMessage["parts"] {
  return parts.map((part) => {
    if (
      part.type.startsWith("tool-") &&
      "state" in part &&
      (part.state === "input-streaming" || part.state === "input-available")
    ) {
      return {
        ...part,
        ...("input" in part ? {} : { input: undefined }),
        state: "output-error",
        errorText: "生成中断，工具调用未完成",
      } as ThreadChatUIMessage["parts"][number]
    }
    return part
  })
}

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
  const parts = repairInterruptedToolParts(stripTransientParts(snapshot.parts))
  const empty = requestedStatus === "completed" && !hasDisplayableParts(parts)
  const status = empty ? "failed" : requestedStatus
  const resolvedError = empty
    ? { code: "EMPTY_RESPONSE", message: "模型没有返回可显示内容" }
    : status === "failed"
      ? (error ?? { code: "GENERATION_FAILED", message: "生成失败" })
      : null
  const finalArtifacts = collectFinalArtifacts(messageId, parts)
  const artifactStats = artifactCallStats(parts)
  if (artifactStats.attempted > 0) {
    /* 计量字段：可查询「调用但没产出」的失败率；不传标题/正文。 */
    logDiagnostic(
      artifactStats.produced < artifactStats.attempted
        ? AI_DIAGNOSTIC_EVENTS.artifactFailed
        : AI_DIAGNOSTIC_EVENTS.artifactCreated,
      {
        assistantMessageId: messageId,
        artifactAttempted: artifactStats.attempted,
        artifactProduced: artifactStats.produced,
        artifactTotalChars: finalArtifacts.reduce(
          (total, artifact) => total + artifact.content.length,
          0
        ),
      },
      undefined,
      artifactStats.produced < artifactStats.attempted ? "warn" : "info"
    )
  }

  return db.transaction(async (tx) => {
    // 结束生成可能插入 Artifact（外键访问 Project），也必须先锁父级。
    const [identity] = await tx.select({ projectId: messages.projectId,
      threadId: messages.threadId, userId: projects.userId }).from(messages)
      .innerJoin(projects, eq(projects.id, messages.projectId)).where(eq(messages.id, messageId))
    if (!identity || !await lockDocumentExecution(tx, { ...identity, messageId })) {
      throw new Error("MESSAGE_NOT_FOUND_DURING_FINALIZE")
    }
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
      const inserted = await tx.insert(artifacts).values(
        finalArtifacts.map((artifact) => ({
          ...artifact,
          projectId: updated.projectId,
          threadId: updated.threadId,
          sourceMessageId: updated.id,
        }))
      ).onConflictDoNothing().returning()
      const [project] = await tx.select({ userId: projects.userId }).from(projects).where(eq(projects.id, updated.projectId))
      if (!project) throw new Error("PROJECT_NOT_FOUND")
      for (const artifact of inserted) await registerDocumentArtifact(tx, artifact, project.userId)
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
