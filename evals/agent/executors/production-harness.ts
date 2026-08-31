import { readFile } from "node:fs/promises"
import { ATTACHMENT_URL_PREFIX } from "@/constants/attachment"
import { GENERATION_CANCEL_REASONS } from "@/constants/generation"
import { assistantMessageTraceId } from "@/lib/observability/identity"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import type { RunGenerationDependencies } from "@/lib/thread-chat/streaming/run-generation"
import { resolveFixturePath } from "@/evals/agent/cases"
import { prepareEvaluationDatabase } from "@/evals/agent/isolation"
import type { AgentExecutionOutput } from "@/evals/agent/result"
import type { AgentCase } from "@/evals/agent/schema"

type SeedAttachment = {
  id: string
  userId: string
  key: string
  filename: string
  mimeType: string
  size: number
  kind: "document" | "image" | "archive" | "video"
  status: "ready"
  pageCount: number | null
  pages: string[] | null
}

type SeedMessage = {
  id: string
  projectId: string
  threadId: string
  sequence: number
  role: "user" | "assistant"
  parts: ThreadChatUIMessage["parts"]
  status: "completed" | "generating"
  modelId: string | null
  startedAt: Date | null
  finishedAt: Date | null
}

type SeedProjectFile = {
  projectId: string
  attachmentId: string
  addedAt: Date
}

export type ProductionEvaluationSeed = {
  user: {
    id: string
    name: string
    email: string
    emailVerified: true
    createdAt: Date
    updatedAt: Date
  }
  project: {
    id: string
    userId: string
    target: string | null
    instructions: string | null
    contractVersion: number
  }
  foreignProject: { id: string; userId: string } | null
  thread: {
    id: string
    projectId: string
    parentId: null
    forkContext: string[]
    depth: 0
    modelId: string
    nextSequence: number
  }
  attachments: SeedAttachment[]
  projectFiles: SeedProjectFile[]
  foreignProjectFiles: SeedProjectFile[]
  messages: SeedMessage[]
  assistantMessageId: string
}

function attachmentKind(mediaType: string): SeedAttachment["kind"] {
  if (mediaType.startsWith("image/")) return "image"
  if (mediaType.startsWith("video/")) return "video"
  if (mediaType === "application/zip") return "archive"
  return "document"
}

function pdfPages(bytes: Buffer): string[] | null {
  const source = bytes.toString("latin1")
  const pages = [...source.matchAll(/\(([^)]*)\)\s*Tj/g)]
    .map((match) => match[1]?.replace(/\\([()\\])/g, "$1").trim())
    .filter((value): value is string => Boolean(value))
  return pages.length > 0 ? pages : null
}

async function seedAttachment(input: {
  fixture: string
  mediaType: string
  filename?: string
  userId: string
  caseId: string
  id: () => string
}): Promise<SeedAttachment> {
  const attachmentId = input.id()
  const bytes = await readFile(resolveFixturePath(input.fixture))
  const pages = input.mediaType === "application/pdf" ? pdfPages(bytes) : null
  return {
    id: attachmentId,
    userId: input.userId,
    key: `evaluations/${input.caseId}/${attachmentId}`,
    filename: input.filename ?? input.fixture,
    mimeType: input.mediaType,
    size: bytes.byteLength,
    kind: attachmentKind(input.mediaType),
    status: "ready",
    pageCount: pages?.length ?? null,
    pages,
  }
}

function numericUsage(value: unknown, prefix = ""): Record<string, number> {
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
      const path = prefix ? `${prefix}.${key}` : key
      if (typeof nested === "number") return [[path, nested] as const]
      return Object.entries(numericUsage(nested, path))
    })
  )
}

/** Build deterministic rows that production compileModelContext can consume. */
export async function buildProductionEvaluationSeed(input: {
  evaluationCase: AgentCase
  modelId: string
}): Promise<ProductionEvaluationSeed> {
  const id = () => crypto.randomUUID()
  const now = new Date()
  const userId = `eval-user-${id()}`
  const projectId = id()
  const threadId = id()
  const projectContext = input.evaluationCase.input.projectContext

  const messageAttachmentRows = await Promise.all(
    input.evaluationCase.input.attachments.map((attachment) =>
      seedAttachment({
        ...attachment,
        userId,
        caseId: input.evaluationCase.id,
        id,
      })
    )
  )
  const projectAttachmentRows = await Promise.all(
    (projectContext?.files ?? []).map((attachment) =>
      seedAttachment({
        ...attachment,
        userId,
        caseId: input.evaluationCase.id,
        id,
      })
    )
  )
  const foreignAttachmentRows = await Promise.all(
    (projectContext?.foreignFiles ?? []).map((attachment) =>
      seedAttachment({
        ...attachment,
        userId,
        caseId: input.evaluationCase.id,
        id,
      })
    )
  )
  const foreignProject =
    foreignAttachmentRows.length > 0 ? { id: id(), userId } : null
  const projectFiles = projectAttachmentRows.map((attachment) => ({
    projectId,
    attachmentId: attachment.id,
    addedAt: now,
  }))
  const foreignProjectFiles = foreignProject
    ? foreignAttachmentRows.map((attachment) => ({
        projectId: foreignProject.id,
        attachmentId: attachment.id,
        addedAt: now,
      }))
    : []

  const lastUserIndex = input.evaluationCase.input.messages.findLastIndex(
    (message) => message.role === "user"
  )
  if (lastUserIndex < 0) throw new Error("Evaluation case has no user message")
  const messages: SeedMessage[] = input.evaluationCase.input.messages.map(
    (message, index) => ({
      id: id(),
      projectId,
      threadId,
      sequence: index + 1,
      role: message.role,
      parts: [
        { type: "text", text: message.text },
        ...(index === lastUserIndex
          ? messageAttachmentRows.map((attachment) => ({
              type: "file",
              url: `${ATTACHMENT_URL_PREFIX}${attachment.id}`,
              mediaType: attachment.mimeType,
              filename: attachment.filename,
            }))
          : []),
      ] as ThreadChatUIMessage["parts"],
      status: "completed",
      modelId: message.role === "assistant" ? input.modelId : null,
      startedAt: message.role === "assistant" ? now : null,
      finishedAt: now,
    })
  )
  const assistantMessageId = id()
  messages.push({
    id: assistantMessageId,
    projectId,
    threadId,
    sequence: messages.length + 1,
    role: "assistant",
    parts: [],
    status: "generating",
    modelId: input.modelId,
    startedAt: now,
    finishedAt: null,
  })
  return {
    user: {
      id: userId,
      name: `Evaluation ${input.evaluationCase.id}`,
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    project: {
      id: projectId,
      userId,
      target: projectContext?.target ?? null,
      instructions: projectContext?.instructions ?? null,
      contractVersion: projectContext ? 1 : 0,
    },
    foreignProject,
    thread: {
      id: threadId,
      projectId,
      parentId: null,
      forkContext: [],
      depth: 0,
      modelId: input.modelId,
      nextSequence: messages.length + 1,
    },
    attachments: [
      ...messageAttachmentRows,
      ...projectAttachmentRows,
      ...foreignAttachmentRows,
    ],
    projectFiles,
    foreignProjectFiles,
    messages,
    assistantMessageId,
  }
}

function terminalText(parts: Array<{ type: string; [key: string]: unknown }>) {
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
}

function terminalRoute(
  parts: Array<{ type: string; [key: string]: unknown }>
): AgentExecutionOutput["route"] {
  const route = parts.find((part) => part.type === "data-research-route")
  if (!route || typeof route.data !== "object" || route.data === null) {
    return undefined
  }
  const mode = (route.data as Record<string, unknown>).mode
  return mode === "answer" ||
    mode === "fetch" ||
    mode === "search" ||
    mode === "research"
    ? mode
    : undefined
}

export async function executeProductionGeneration(input: {
  evaluationCase: AgentCase
  modelId: string
  abortSignal: AbortSignal
  prepare?: RunGenerationDependencies["prepare"]
}): Promise<AgentExecutionOutput> {
  await prepareEvaluationDatabase()
  const [drizzle, { db }, schema, application, streaming] = await Promise.all([
    import("drizzle-orm"),
    import("@/lib/db"),
    import("@/lib/db/schema"),
    import("@/lib/thread-chat/application"),
    import("@/lib/thread-chat/streaming"),
  ])
  const seed = await buildProductionEvaluationSeed(input)
  const store = new streaming.SessionStore({ startCleanupTimer: false })
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.user).values(seed.user)
      await tx.insert(schema.projects).values([
        seed.project,
        ...(seed.foreignProject ? [seed.foreignProject] : []),
      ])
      await tx.insert(schema.threads).values(seed.thread)
      if (seed.attachments.length > 0) {
        await tx.insert(schema.attachments).values(seed.attachments)
      }
      if (seed.projectFiles.length > 0) {
        await tx.insert(schema.projectFiles).values(seed.projectFiles)
      }
      if (seed.foreignProjectFiles.length > 0) {
        await tx.insert(schema.projectFiles).values(seed.foreignProjectFiles)
      }
      await tx.insert(schema.messages).values(seed.messages)
    })
    const run = store.start({
      messageId: seed.assistantMessageId,
      initialSnapshot: streaming.initialAssistantSnapshot({
        messageId: seed.assistantMessageId,
        threadId: seed.thread.id,
        modelId: input.modelId,
      }),
      run: (session) =>
        streaming.runGeneration({
          userId: seed.user.id,
          messageId: seed.assistantMessageId,
          session,
          ...(input.prepare
            ? {
                dependencies: {
                  prepare: input.prepare,
                },
              }
            : {}),
        }),
    })
    const abortForEvaluationDeadline = () => {
      store.abort(
        seed.assistantMessageId,
        GENERATION_CANCEL_REASONS.evaluationTimeout
      )
    }
    input.abortSignal.addEventListener("abort", abortForEvaluationDeadline, {
      once: true,
    })
    if (input.abortSignal.aborted) abortForEvaluationDeadline()
    if (input.evaluationCase.input.lifecycleScenario === "stop") {
      store.abort(seed.assistantMessageId, GENERATION_CANCEL_REASONS.userStop)
    }
    try {
      await run.session.task
      const [terminal, terminalRow] = await Promise.all([
        application.getMessage(seed.user.id, seed.assistantMessageId),
        db
          .select({ providerUsage: schema.messages.providerUsage })
          .from(schema.messages)
          .where(drizzle.eq(schema.messages.id, seed.assistantMessageId))
          .limit(1),
      ])
      if (!terminal) throw new Error("Evaluation terminal message missing")
      const parts = terminal.parts as Array<{
        type: string
        [key: string]: unknown
      }>
      const route = terminalRoute(parts)
      return {
        traceId: await assistantMessageTraceId(seed.assistantMessageId),
        text: terminalText(parts),
        tools: parts
          .filter((part) => part.type.startsWith("tool-"))
          .map((part) => part.type.slice("tool-".length)),
        terminalState:
          terminal.status === "generating" ? "failed" : terminal.status,
        ...(route ? { route } : {}),
        usage: numericUsage(terminalRow[0]?.providerUsage),
      }
    } finally {
      input.abortSignal.removeEventListener(
        "abort",
        abortForEvaluationDeadline
      )
    }
  } finally {
    store.dispose()
    await db
      .delete(schema.user)
      .where(drizzle.eq(schema.user.id, seed.user.id))
      .catch(() => undefined)
  }
}
