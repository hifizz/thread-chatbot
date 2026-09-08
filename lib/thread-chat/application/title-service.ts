import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { projects, threads } from "@/lib/db/schema"
import type {
  ProjectDTO,
  ThreadDTO,
  ThreadTitleDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { ThreadTitleInput } from "@/lib/thread-chat/contracts/title-request"
import { isRootThread } from "@/lib/thread-chat/domain/root-thread"
import { generateThreadTitleText } from "@/lib/thread-chat/application/title-generator"
import { notFound } from "@/lib/thread-chat/application/errors"
import {
  toProjectDTO,
  toThreadDTO,
} from "@/lib/thread-chat/persistence/mappers"
import { listThreadMessageRows } from "@/lib/thread-chat/persistence/message-repository"
import {
  findOwnedProject,
  findRootThreadId,
} from "@/lib/thread-chat/persistence/project-repository"
import { findOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"
import { withConversationTransaction } from "@/lib/thread-chat/persistence/transaction"

type ThreadRow = typeof threads.$inferSelect

function textFromParts(parts: readonly unknown[]): string {
  return parts
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) return []
      const value = part as Record<string, unknown>
      return value.type === "text" && typeof value.text === "string"
        ? [value.text]
        : []
    })
    .join("\n")
    .trim()
}

async function loadThreadTitleTarget(
  userId: string,
  threadId: string
): Promise<{ project: ProjectDTO; thread: ThreadDTO }> {
  const thread = await findOwnedThread(db, userId, threadId)
  if (!thread) notFound()
  const project = await findOwnedProject(db, userId, thread.projectId)
  if (!project) notFound()
  const rootThreadId = await findRootThreadId(db, project.id)
  if (!rootThreadId) notFound()
  return {
    project: toProjectDTO(project, rootThreadId),
    thread: toThreadDTO(thread),
  }
}

function firstCurrentUserMessage(
  rows: Awaited<ReturnType<typeof listThreadMessageRows>>
) {
  return rows.find(
    (row) => row.role === "user" && row.supersededAt === null
  )
}

function firstCurrentAssistantAnswer(
  rows: Awaited<ReturnType<typeof listThreadMessageRows>>
) {
  return rows.find(
    (row) =>
      row.role === "assistant" &&
      row.supersededAt === null &&
      (row.status === "completed" || row.status === "stopped") &&
      textFromParts(row.parts) !== ""
  )
}

async function buildTitleInput(
  thread: ThreadRow
): Promise<ThreadTitleInput | null> {
  const rows = await listThreadMessageRows(db, thread.projectId, thread.id)
  const firstUser = firstCurrentUserMessage(rows)
  const question = firstUser ? textFromParts(firstUser.parts) : ""
  if (!question) return null

  if (isRootThread(thread) || !thread.anchorText) return { kind: "main", question }

  const firstAnswer = firstCurrentAssistantAnswer(rows)
  const answer = firstAnswer ? textFromParts(firstAnswer.parts) : ""
  if (!answer) return null
  return {
    kind: "branch",
    anchorText: thread.anchorText,
    question,
    answer,
  }
}

export function claimTitleGenerationAttempt(
  userId: string,
  threadId: string
): Promise<boolean> {
  return withConversationTransaction(async (tx) => {
    const thread = await findOwnedThread(tx, userId, threadId)
    if (!thread) return false
    const [claimed] = await tx
      .update(threads)
      .set({ titleGenerationAttempted: true, updatedAt: new Date() })
      .where(
        and(
          eq(threads.id, thread.id),
          eq(threads.titleGenerationAttempted, false)
        )
      )
      .returning({ id: threads.id })
    return Boolean(claimed)
  })
}

export function saveGeneratedTitle(
  userId: string,
  threadId: string,
  title: string
): Promise<boolean> {
  return withConversationTransaction(async (tx) => {
    const thread = await findOwnedThread(tx, userId, threadId)
    if (!thread || !thread.titleGenerationAttempted) return false
    const now = new Date()
    const [updated] = await tx
      .update(threads)
      .set({ autoTitle: title, titleGenerated: true, updatedAt: now })
      .where(and(eq(threads.id, thread.id), eq(threads.titleGenerated, false)))
      .returning({ id: threads.id })
    if (!updated) return false
    if (isRootThread(thread)) {
      await tx
        .update(projects)
        .set({ autoTitle: title, updatedAt: now })
        .where(eq(projects.id, thread.projectId))
    }
    return true
  })
}

export async function generateAndSaveThreadTitle(
  userId: string,
  threadId: string,
  generateTitle: (input: ThreadTitleInput) => Promise<string | null> =
    generateThreadTitleText
): Promise<ThreadTitleDTO> {
  const thread = await findOwnedThread(db, userId, threadId)
  if (!thread) notFound()
  const input = await buildTitleInput(thread)
  if (!input) {
    const target = await loadThreadTitleTarget(userId, threadId)
    return { ...target, title: null, generated: false }
  }

  const claimed = await claimTitleGenerationAttempt(userId, threadId)
  if (!claimed) {
    const target = await loadThreadTitleTarget(userId, threadId)
    return {
      ...target,
      title: target.thread.autoTitle,
      generated: false,
    }
  }

  const title = await generateTitle(input)
  if (title) await saveGeneratedTitle(userId, threadId, title)
  const target = await loadThreadTitleTarget(userId, threadId)
  return { ...target, title, generated: Boolean(title) }
}
