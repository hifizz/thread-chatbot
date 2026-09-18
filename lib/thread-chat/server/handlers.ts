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
import {
  generationHeartbeatLive,
  readGenerationLease,
} from "@/lib/thread-chat/streaming/generation-ownership"
import { getInstanceId, isFlyRuntime } from "@/lib/runtime/instance"
import { isDraining } from "@/lib/runtime/drain"
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

/** drain 期间拒绝受理新 Generation；在读/停止等命令不受影响。 */
function assertAcceptingGenerations(): void {
  if (isDraining()) {
    throw new ConversationApplicationError(
      "CAPACITY_UNAVAILABLE",
      "服务正在部署更新，请稍后重试"
    )
  }
}

/**
 * 目标实例定向重放（Fly fly-replay）。请求经代理重放到生成属主实例；
 * 失败由 fallback=prefer_self 回本机，此时带 fly-replay-failed 头，不再重放。
 */
function flyReplayResponse(ownerId: string): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "fly-replay": `instance=${ownerId};timeout=5s;fallback=prefer_self`,
    },
  })
}

function canReplayTo(request: Request, ownerId: string | null): ownerId is string {
  return Boolean(
    isFlyRuntime() &&
      ownerId &&
      ownerId !== getInstanceId() &&
      !request.headers.has("fly-replay-failed")
  )
}

/**
 * 本机没有该生成的 Session 时的多实例处置：
 * - 属主心跳存活 → 返回 fly-replay 定向响应（或无 Fly 时返回 null，靠属主轮询标志）；
 * - 属主已死 → 把孤儿生成终态化为 SESSION_LOST，返回 null 让调用方按正常流程响应。
 */
async function foreignGenerationResponse(
  request: Request,
  messageId: string
): Promise<Response | null> {
  const lease = await readGenerationLease(messageId)
  if (!lease || lease.status !== "generating") return null
  if (
    generationHeartbeatLive({
      generationHeartbeatAt: lease.generationHeartbeatAt,
    })
  ) {
    if (canReplayTo(request, lease.generationOwner)) {
      return flyReplayResponse(lease.generationOwner)
    }
    return null
  }
  await failOrphanedGeneratingMessage(messageId)
  return null
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
    assertAcceptingGenerations()
    const command = await parseJson(request, startProjectCommandSchema)
    if (command.projectId !== parseId(projectId))
      validation("path projectId 与请求体不一致")
    const result = await startProject(userId, command)
    if (!result.replayed)
      startSessionAfterCommit(
        userId,
        result.result,
        command.generationSettings
      )
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
    assertAcceptingGenerations()
    const command = await parseJson(request, sendMessageCommandSchema)
    const result = await sendMessage(userId, parseId(threadId), command)
    if (!result.replayed)
      startSessionAfterCommit(
        userId,
        result.result,
        command.generationSettings
      )
    return commandResponse(result)
  })
}

export function handleForkThread(
  request: Request,
  threadId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    assertAcceptingGenerations()
    const command = await parseJson(request, forkThreadCommandSchema)
    const result = await forkThread(userId, parseId(threadId), command)
    if (!result.replayed && result.result.generation)
      startSessionAfterCommit(
        userId,
        result.result.generation,
        command.generationSettings
      )
    return commandResponse(result)
  })
}

export function handleEditMessage(
  request: Request,
  messageId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    assertAcceptingGenerations()
    const command = await parseJson(request, editLatestTurnCommandSchema)
    const result = await editLatestTurn(userId, parseId(messageId), command)
    if (result.result.abortMessageId) {
      const aborted = getSessionStore().abort(
        result.result.abortMessageId,
        GENERATION_CANCEL_REASONS.supersededByEdit
      )
      if (!aborted) {
        const replay = await foreignGenerationResponse(
          request,
          result.result.abortMessageId
        )
        if (replay) return replay
      }
    }
    if (!result.replayed) {
      startSessionAfterCommit(
        userId,
        result.result.generation,
        command.generationSettings
      )
    }
    return commandResponse(result)
  })
}

export function handleRetryMessage(
  request: Request,
  messageId: string
): Promise<Response> {
  return withThreadChatRoute(request, async (userId) => {
    assertAcceptingGenerations()
    const command = await parseJson(request, retryMessageCommandSchema)
    const result = await retryMessage(userId, parseId(messageId), command)
    if (!result.replayed)
      startSessionAfterCommit(
        userId,
        result.result,
        command.generationSettings
      )
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
    if (result.result.status === "generating") {
      const aborted = getSessionStore().abort(
        id,
        GENERATION_CANCEL_REASONS.userStop
      )
      if (!aborted) {
        // 生成在其他实例：replay 直达属主；非 Fly 环境靠属主轮询 DB 标志兜底。
        const replay = await foreignGenerationResponse(request, id)
        if (replay) return replay
      }
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
    if (response) return response
    // 本机无 Session：生成在别的实例时 fly-replay 到属主；属主已死则清扫孤儿。
    const replay = await foreignGenerationResponse(request, id)
    if (replay) return replay
    throw new Error("SESSION_NOT_AVAILABLE")
  })
}
