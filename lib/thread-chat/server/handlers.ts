import { z } from "zod"
import {
  addProjectFileCommandSchema,
  deleteProjectCommandSchema,
  editLatestTurnCommandSchema,
  forkThreadCommandSchema,
  removeProjectFileCommandSchema,
  renameProjectCommandSchema,
  retryMessageCommandSchema,
  sendMessageCommandSchema,
  setFeedbackCommandSchema,
  setProjectArchivedCommandSchema,
  startProjectCommandSchema,
  stopMessageCommandSchema,
  updateProjectContractCommandSchema,
  updateThreadCommandSchema,
} from "@/lib/thread-chat/contracts/commands"
import {
  addProjectFile,
  deleteProject,
  editLatestTurn,
  forkThread,
  getArtifact,
  getMessage,
  getProjectBootstrap,
  listProjects,
  removeProjectFile,
  renameProject,
  requestMessageStop,
  retryMessage,
  sendMessage,
  setMessageFeedback,
  setProjectArchived,
  generateAndSaveThreadTitle,
  startProject,
  updateProjectContract,
  updateThread,
} from "@/lib/thread-chat/application"
import { ConversationApplicationError } from "@/lib/thread-chat/application/errors"
import { startSessionAfterCommit } from "@/lib/thread-chat/server/start-session-after-commit"
import {
  commandResponse,
  jsonNoCache,
  parseJson,
  withThreadChatRoute,
} from "@/lib/thread-chat/server/route-utils"
import { failOrphanedGeneratingMessage } from "@/lib/thread-chat/streaming/finalize"
import { getSessionStore } from "@/lib/thread-chat/streaming/session-store"
import { createSessionSseResponse } from "@/lib/thread-chat/streaming/sse"
import { GENERATION_CANCEL_REASONS } from "@/constants/generation"
import { scheduleFeedbackMirrorAfterCommit } from "@/lib/observability/feedback-post-commit"

const idSchema = z.uuid()

function parseId(value: string): string {
  return idSchema.parse(value)
}

function validation(message: string): never {
  throw new ConversationApplicationError("VALIDATION_ERROR", message)
}

export function handleListProjects(request: Request): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const url = new URL(request.url)
    const unknown = [...url.searchParams.keys()].filter(
      (key) => key !== "archived"
    )
    if (unknown.length > 0) validation("查询参数不合法")
    const archivedValue = url.searchParams.get("archived")
    if (
      archivedValue !== null &&
      archivedValue !== "true" &&
      archivedValue !== "false"
    )
      validation("archived 必须是 true 或 false")
    return jsonNoCache(await listProjects(userId, archivedValue === "true"))
  })
}

export function handleGetProject(
  request: Request,
  projectId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) =>
    jsonNoCache(await getProjectBootstrap(userId, parseId(projectId)))
  )
}

export function handleStartProject(
  request: Request,
  projectId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const command = await parseJson(request, startProjectCommandSchema)
    if (command.projectId !== parseId(projectId))
      validation("path projectId 与请求体不一致")
    const result = await startProject(userId, command)
    if (!result.replayed) startSessionAfterCommit(userId, result.result)
    return commandResponse(result)
  })
}

export function handlePatchProject(
  request: Request,
  projectId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const id = parseId(projectId)
    const command = await parseJson(
      request,
      z.union([
        renameProjectCommandSchema,
        setProjectArchivedCommandSchema,
        updateProjectContractCommandSchema,
      ])
    )
    const result =
      "expectedContractVersion" in command
        ? await updateProjectContract(userId, id, command)
        : "customTitle" in command
          ? await renameProject(userId, id, command)
          : await setProjectArchived(userId, id, command)
    return commandResponse(result)
  })
}

export function handleAddProjectFile(
  request: Request,
  projectId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) =>
    commandResponse(
      await addProjectFile(
        userId,
        parseId(projectId),
        await parseJson(request, addProjectFileCommandSchema)
      )
    )
  )
}

export function handleRemoveProjectFile(
  request: Request,
  projectId: string,
  attachmentId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const id = parseId(attachmentId)
    const command = await parseJson(request, removeProjectFileCommandSchema)
    if (command.attachmentId !== id)
      validation("path attachmentId 与请求体不一致")
    return commandResponse(
      await removeProjectFile(userId, parseId(projectId), command)
    )
  })
}

export function handleDeleteProject(
  request: Request,
  projectId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const id = parseId(projectId)
    const beforeDelete = await getProjectBootstrap(userId, id)
    const result = await deleteProject(
      userId,
      id,
      await parseJson(request, deleteProjectCommandSchema)
    )
    if (!result.replayed) {
      const now = new Date().toISOString()
      for (const messageId of beforeDelete.activeGenerationIds) {
        const message = beforeDelete.messages.find(
          (item) => item.id === messageId
        )
        if (!message) continue
        getSessionStore().discard(messageId, {
          ...message,
          status: "failed",
          error: { code: "PROJECT_DELETED", message: "Project 已删除" },
          updatedAt: now,
          finishedAt: now,
        })
      }
    }
    return commandResponse(result)
  })
}

export function handlePatchThread(
  request: Request,
  threadId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) =>
    commandResponse(
      await updateThread(
        userId,
        parseId(threadId),
        await parseJson(request, updateThreadCommandSchema)
      )
    )
  )
}

export function handleGenerateThreadTitle(
  request: Request,
  threadId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) =>
    jsonNoCache(await generateAndSaveThreadTitle(userId, parseId(threadId)))
  )
}

export function handleSendMessage(
  request: Request,
  threadId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const result = await sendMessage(
      userId,
      parseId(threadId),
      await parseJson(request, sendMessageCommandSchema)
    )
    if (!result.replayed) startSessionAfterCommit(userId, result.result)
    return commandResponse(result)
  })
}

export function handleForkThread(
  request: Request,
  threadId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const result = await forkThread(
      userId,
      parseId(threadId),
      await parseJson(request, forkThreadCommandSchema)
    )
    if (!result.replayed && result.result.generation)
      startSessionAfterCommit(userId, result.result.generation)
    return commandResponse(result)
  })
}

export function handleEditMessage(
  request: Request,
  messageId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const result = await editLatestTurn(
      userId,
      parseId(messageId),
      await parseJson(request, editLatestTurnCommandSchema)
    )
    if (!result.replayed) {
      if (result.result.abortMessageId)
        if (
          !getSessionStore().abort(
            result.result.abortMessageId,
            GENERATION_CANCEL_REASONS.supersededByEdit
          )
        )
          await failOrphanedGeneratingMessage(result.result.abortMessageId)
      startSessionAfterCommit(userId, result.result.generation)
    }
    return commandResponse(result)
  })
}

export function handleRetryMessage(
  request: Request,
  messageId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const result = await retryMessage(
      userId,
      parseId(messageId),
      await parseJson(request, retryMessageCommandSchema)
    )
    if (!result.replayed) startSessionAfterCommit(userId, result.result)
    return commandResponse(result)
  })
}

export function handleStopMessage(
  request: Request,
  messageId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const id = parseId(messageId)
    const result = await requestMessageStop(
      userId,
      id,
      await parseJson(request, stopMessageCommandSchema)
    )
    if (!result.replayed && result.result.status === "generating") {
      const aborted = getSessionStore().abort(
        id,
        GENERATION_CANCEL_REASONS.userStop
      )
      if (!aborted) await failOrphanedGeneratingMessage(id)
    }
    return commandResponse(result)
  })
}

export function handleSetFeedback(
  request: Request,
  messageId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const result = await setMessageFeedback(
      userId,
      parseId(messageId),
      await parseJson(request, setFeedbackCommandSchema)
    )
    scheduleFeedbackMirrorAfterCommit(result.result)
    return commandResponse(result)
  })
}

export function handleGetMessage(
  request: Request,
  messageId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const message = await getMessage(userId, parseId(messageId))
    if (!message)
      throw new ConversationApplicationError("NOT_FOUND", "资源不存在")
    return jsonNoCache(message)
  })
}

export function handleGetArtifact(
  request: Request,
  artifactId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const artifact = await getArtifact(userId, parseId(artifactId))
    if (!artifact)
      throw new ConversationApplicationError("NOT_FOUND", "资源不存在")
    return jsonNoCache(artifact)
  })
}

export function handleMessageStream(
  request: Request,
  messageId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    const id = parseId(messageId)
    const message = await getMessage(userId, id)
    if (!message)
      throw new ConversationApplicationError("NOT_FOUND", "资源不存在")
    const response = createSessionSseResponse({
      store: getSessionStore(),
      messageId: id,
    })
    if (!response) throw new Error("SESSION_NOT_AVAILABLE")
    return response
  })
}
