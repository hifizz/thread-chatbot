import { z } from "zod"
import type { UIMessage } from "ai"
import {
  assistantEventsQuerySchema,
  createProjectRequestSchema,
  editMessageRequestSchema,
  forkThreadRequestSchema,
  idSchema,
  listProjectsQuerySchema,
  patchProjectRequestSchema,
  patchThreadRequestSchema,
  putFeedbackRequestSchema,
  regenerateMessageRequestSchema,
  sendMessageRequestSchema,
  threadMessagesQuerySchema,
} from "../contracts"
import { decodeProjectCursor, encodeProjectCursor } from "./cursor"
import { ThreadChatApiError } from "./errors"
import { jsonData, readJson } from "./http"
import {
  toArtifactDTO,
  toAssistantRunStateDTO,
  toMessageDTO,
  toProjectDTO,
  toProjectSummaryDTO,
  toThreadDTO,
  toThreadMessageBundleDTO,
} from "./mappers"
import { threadChatServer } from "./runtime"

function queryObject(request: Request): Record<string, string> {
  const entries = [...new URL(request.url).searchParams.entries()]
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw new ThreadChatApiError("invalid_query", 400, "Duplicate query parameter.")
  return Object.fromEntries(entries)
}

function validatePathIds(...ids: string[]): void {
  for (const id of ids) idSchema.parse(id)
}

export async function listProjects(actorId: string, request: Request) {
  let query: z.infer<typeof listProjectsQuerySchema>
  try {
    query = listProjectsQuerySchema.parse(queryObject(request))
  } catch (error) {
    if (error instanceof ThreadChatApiError) throw error
    throw new ThreadChatApiError("invalid_query", 400, "Invalid project query.")
  }
  const before = query.cursor
    ? decodeProjectCursor(query.cursor, {
        actorId,
        status: query.status,
      })
    : undefined
  const projects = await threadChatServer.queries.listProjects({
    actorId,
    status: query.status,
    limit: query.limit + 1,
    before,
  })
  const hasNext = projects.length > query.limit
  const items = projects.slice(0, query.limit)
  const last = items.at(-1)
  return jsonData({
    items: items.map(toProjectSummaryDTO),
    nextCursor:
      hasNext && last
        ? encodeProjectCursor({
            actorId,
            status: query.status,
            updatedAt: last.updatedAt.toISOString(),
            id: last.id,
          })
        : null,
  })
}

export async function createProject(actorId: string, request: Request) {
  const body = createProjectRequestSchema.parse(await readJson(request))
  const result = await threadChatServer.commands().createProject({
    actorId,
    parts: body.initialMessage.parts as UIMessage["parts"],
    requestedModelId: body.requestedModelId,
  })
  return jsonData(
    {
      project: toProjectDTO(result.project),
      rootThread: toThreadDTO(result.rootThread),
      artifactSummary: result.artifactSummary,
      userMessage: toMessageDTO(result.userMessage),
      assistantMessage: toMessageDTO(result.assistantMessage),
      assistantRun: toAssistantRunStateDTO(result.assistantRun),
    },
    201
  )
}

export async function bootstrapProject(actorId: string, projectId: string) {
  validatePathIds(projectId)
  const result = await threadChatServer.queries.projectBootstrap({
    actorId,
    projectId,
  })
  return jsonData({
    project: toProjectDTO(result.project),
    threadTopology: result.threadTopology.map(toThreadDTO),
    artifactSummary: result.artifactSummary,
    initialThread: toThreadMessageBundleDTO(result.initialThread),
  })
}

export async function patchProject(
  actorId: string,
  projectId: string,
  request: Request
) {
  validatePathIds(projectId)
  const patch = patchProjectRequestSchema.parse(await readJson(request))
  const project = await threadChatServer.commands().patchProject({
    actorId,
    projectId,
    patch,
  })
  return jsonData(toProjectDTO(project))
}

export async function setProjectArchived(
  actorId: string,
  projectId: string,
  archived: boolean
) {
  validatePathIds(projectId)
  const project = await threadChatServer.commands().setProjectArchived({
    actorId,
    projectId,
    archived,
  })
  return jsonData(toProjectDTO(project))
}

export async function deleteProject(actorId: string, projectId: string) {
  validatePathIds(projectId)
  await threadChatServer.commands().deleteProject({ actorId, projectId })
  return new Response(null, { status: 204 })
}

export async function loadThreadMessages(
  actorId: string,
  threadId: string,
  request: Request
) {
  validatePathIds(threadId)
  let query: z.infer<typeof threadMessagesQuerySchema>
  try {
    query = threadMessagesQuerySchema.parse(queryObject(request))
  } catch {
    throw new ThreadChatApiError("invalid_query", 400, "Invalid message query.")
  }
  const bundle = await threadChatServer.queries.threadMessages({
    actorId,
    threadId,
    ...query,
  })
  return jsonData(toThreadMessageBundleDTO(bundle))
}

export async function sendMessage(
  actorId: string,
  threadId: string,
  request: Request
) {
  validatePathIds(threadId)
  const body = sendMessageRequestSchema.parse(await readJson(request))
  const result = await threadChatServer.commands().sendMessage({
    actorId,
    threadId,
    parts: body.parts as UIMessage["parts"],
    requestedModelId: body.requestedModelId,
  })
  return jsonData(
    {
      userMessage: toMessageDTO(result.userMessage),
      assistantMessage: toMessageDTO(result.assistantMessage),
      assistantRun: toAssistantRunStateDTO(result.assistantRun),
    },
    201
  )
}

export async function patchThread(
  actorId: string,
  threadId: string,
  request: Request
) {
  validatePathIds(threadId)
  const body = patchThreadRequestSchema.parse(await readJson(request))
  const thread = await threadChatServer.commands().patchBranch({
    actorId,
    threadId,
    customTitle: body.customTitle,
  })
  return jsonData(toThreadDTO(thread))
}

export async function setThreadArchived(
  actorId: string,
  threadId: string,
  archived: boolean
) {
  validatePathIds(threadId)
  const thread = await threadChatServer.commands().patchBranch({
    actorId,
    threadId,
    archived,
  })
  return jsonData(toThreadDTO(thread))
}

export async function forkThread(
  actorId: string,
  threadId: string,
  request: Request
) {
  validatePathIds(threadId)
  const body = forkThreadRequestSchema.parse(await readJson(request))
  const thread = await threadChatServer.commands().forkThread({
    actorId,
    sourceThreadId: threadId,
    sourceMessageId: body.sourceMessageId,
    anchor: body.anchor,
  })
  return jsonData({ thread: toThreadDTO(thread) }, 201)
}

export async function editMessage(
  actorId: string,
  messageId: string,
  request: Request
) {
  validatePathIds(messageId)
  const body = editMessageRequestSchema.parse(await readJson(request))
  const result = await threadChatServer.commands().editLastUser({
    actorId,
    sourceUserMessageId: messageId,
    parts: body.parts as UIMessage["parts"],
    requestedModelId: body.requestedModelId,
  })
  return jsonData(
    {
      supersededMessageIds: result.supersededMessageIds,
      createdMessages: result.createdMessages.map(toMessageDTO),
      assistantRun: toAssistantRunStateDTO(result.assistantRun),
    },
    201
  )
}

export async function regenerateMessage(
  actorId: string,
  messageId: string,
  request: Request
) {
  validatePathIds(messageId)
  const body = regenerateMessageRequestSchema.parse(await readJson(request))
  const result = await threadChatServer.commands().regenerate({
    actorId,
    sourceAssistantMessageId: messageId,
    requestedModelId: body.requestedModelId,
  })
  return jsonData(
    {
      supersededMessageIds: result.supersededMessageIds,
      createdMessages: result.createdMessages.map(toMessageDTO),
      assistantRun: toAssistantRunStateDTO(result.assistantRun),
    },
    201
  )
}

export async function setFeedback(
  actorId: string,
  messageId: string,
  request: Request
) {
  validatePathIds(messageId)
  const body = putFeedbackRequestSchema.parse(await readJson(request))
  const feedback = await threadChatServer.commands().setFeedback({
    actorId,
    assistantMessageId: messageId,
    feedback: body.value,
  })
  return jsonData({
    messageId: feedback.messageId,
    value: feedback.value,
    updatedAt: feedback.updatedAt.toISOString(),
  })
}

export async function loadArtifact(actorId: string, artifactId: string) {
  validatePathIds(artifactId)
  const artifact = await threadChatServer.queries.artifactById({
    actorId,
    artifactId,
  })
  return jsonData(toArtifactDTO(artifact))
}

export async function stopAssistant(actorId: string, assistantMessageId: string) {
  validatePathIds(assistantMessageId)
  const run = await threadChatServer.runner.requestStop({
    actorId,
    assistantMessageId,
  })
  return jsonData(toAssistantRunStateDTO(run))
}

export async function assistantEvents(
  actorId: string,
  assistantMessageId: string,
  request: Request
) {
  validatePathIds(assistantMessageId)
  let query: z.infer<typeof assistantEventsQuerySchema>
  try {
    query = assistantEventsQuerySchema.parse(queryObject(request))
  } catch {
    throw new ThreadChatApiError(
      "invalid_query",
      400,
      "Invalid event query."
    )
  }
  const initial = await threadChatServer.queries.assistantSnapshot({
    actorId,
    assistantMessageId,
  })
  if (query.afterEventSequence > initial.run.eventSequence)
    throw new ThreadChatApiError(
      "invalid_event_cursor",
      409,
      "Event cursor is ahead of the server cursor."
    )

  const encoder = new TextEncoder()
  let cancelled = false
  const encodeEvent = (event: unknown) =>
    encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let snapshot = initial
      let cursor = snapshot.run.eventSequence
      controller.enqueue(
        encodeEvent({
          type: "run.snapshot",
          cursor,
          run: toAssistantRunStateDTO(snapshot.run),
          message: toMessageDTO(snapshot.message),
          artifactSummary: snapshot.artifactSummary,
        })
      )
      if (["completed", "failed", "stopped"].includes(snapshot.run.status)) {
        controller.close()
        return
      }
      while (!cancelled && !request.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        snapshot = await threadChatServer.queries.assistantSnapshot({
          actorId,
          assistantMessageId,
        })
        if (snapshot.run.eventSequence <= cursor) continue
        cursor = snapshot.run.eventSequence
        if (snapshot.run.status === "completed") {
          controller.enqueue(
            encodeEvent({
              type: "run.completed",
              eventSequence: cursor,
              run: toAssistantRunStateDTO(snapshot.run),
              message: toMessageDTO(snapshot.message),
              artifactSummary: snapshot.artifactSummary,
            })
          )
          controller.close()
          return
        }
        if (snapshot.run.status === "failed") {
          controller.enqueue(
            encodeEvent({
              type: "run.failed",
              eventSequence: cursor,
              run: toAssistantRunStateDTO(snapshot.run),
            })
          )
          controller.close()
          return
        }
        if (snapshot.run.status === "stopped") {
          controller.enqueue(
            encodeEvent({
              type: "run.stopped",
              eventSequence: cursor,
              run: toAssistantRunStateDTO(snapshot.run),
              message: toMessageDTO(snapshot.message),
            })
          )
          controller.close()
          return
        }
        controller.enqueue(
          encodeEvent({
            type: "run.delta",
            eventSequence: cursor,
            chunk: {
              type: "data-run-checkpoint",
              id: assistantMessageId,
              data: { checkpointParts: snapshot.run.checkpointParts },
            },
          })
        )
      }
      if (!cancelled) controller.close()
    },
    cancel() {
      cancelled = true
    },
  })
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
    },
  })
}
