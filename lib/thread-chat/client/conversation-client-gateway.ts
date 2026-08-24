import type {
  CommandSuccess,
  CreateConversationPayload,
  EditTurnInputPayload,
  ForkThreadPayload,
  RegenerateTurnPayload,
  RenamePayload,
  SelectTurnVariantPayload,
  SendTurnPayload,
} from "../application/conversation-command-contracts"
import type { CanonicalGenerationRecord } from "../application/conversation-generation-service"
import {
  canonicalMessageFeedbackListSchema,
  setCanonicalMessageFeedbackResponseSchema,
  type CanonicalMessageFeedback,
} from "../contracts/conversation-message-feedback"
import type { MessageFeedback } from "../contracts/message-feedback"
import type {
  ConversationId,
  GenerationId,
  ProjectId,
  ThreadId,
  TurnId,
} from "../domain/conversation-model"
import {
  conversationErrorEnvelopeSchema,
  conversationListQueryDataSchema,
  conversationAuthorityStateSchema,
  generationQueryDataSchema,
  parseCommandSuccess,
  parseConversationQuery,
  parseConversationSnapshotQuery,
} from "./conversation-client-contracts"
import type {
  NormalizedConversationStore,
  PendingCommandOverlay,
} from "./normalized-conversation-store"

export interface ConversationClientErrorShape {
  readonly code: string
  readonly message: string
  readonly requestId?: string
  readonly details?: Readonly<Record<string, unknown>>
  readonly status?: number
  readonly commandId?: string
  readonly uncertain?: boolean
}

export class ConversationClientError extends Error {
  readonly code: string
  readonly requestId?: string
  readonly details?: Readonly<Record<string, unknown>>
  readonly status?: number
  readonly commandId?: string
  readonly uncertain: boolean

  constructor(shape: ConversationClientErrorShape) {
    super(shape.message)
    this.name = "ConversationClientError"
    this.code = shape.code
    this.requestId = shape.requestId
    this.details = shape.details
    this.status = shape.status
    this.commandId = shape.commandId
    this.uncertain = shape.uncertain ?? false
  }
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

interface PendingRequest {
  readonly commandId: string
  readonly conversationId: ConversationId
  /** 新建另一个 Conversation 时，结果属于新的聚合，不能安装进当前页面 store。 */
  readonly mergeIntoCurrentStore: boolean
  readonly url: string
  readonly init: RequestInit
}

export interface CommandOptions {
  readonly commandId?: string
  readonly overlay?: Omit<PendingCommandOverlay, "commandId" | "status">
}

export interface ConversationClientGateway {
  readonly verifyAuthority: (expected: {
    readonly authority: "canonical"
    readonly schemaVersion: number
    readonly epoch: string
  }) => Promise<void>
  readonly listConversations: (
    projectId: ProjectId,
    includeArchived?: boolean
  ) => Promise<
    ReturnType<typeof conversationListQueryDataSchema.parse>["conversations"]
  >
  readonly loadConversation: (conversationId: ConversationId) => Promise<void>
  readonly createConversation: (
    projectId: ProjectId,
    payload: CreateConversationPayload,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly renameConversation: (
    conversationId: ConversationId,
    payload: RenamePayload,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly archiveConversation: (
    conversationId: ConversationId,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly restoreConversation: (
    conversationId: ConversationId,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly deleteConversation: (
    conversationId: ConversationId,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly renameThread: (
    threadId: ThreadId,
    payload: RenamePayload,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly archiveThread: (
    threadId: ThreadId,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly restoreThread: (
    threadId: ThreadId,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly forkThread: (
    parentThreadId: ThreadId,
    payload: ForkThreadPayload,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly sendTurn: (
    threadId: ThreadId,
    payload: SendTurnPayload,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly editTurnInput: (
    turnId: TurnId,
    payload: EditTurnInputPayload,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly regenerateTurn: (
    turnId: TurnId,
    payload: RegenerateTurnPayload,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly selectTurnVariant: (
    turnId: TurnId,
    payload: SelectTurnVariantPayload,
    options?: CommandOptions
  ) => Promise<CommandSuccess>
  readonly getGeneration: (
    generationId: GenerationId
  ) => Promise<CanonicalGenerationRecord>
  readonly stopGeneration: (
    generationId: GenerationId
  ) => Promise<CanonicalGenerationRecord>
  readonly listMessageFeedback: (
    conversationId: ConversationId
  ) => Promise<readonly CanonicalMessageFeedback[]>
  readonly setMessageFeedback: (input: {
    readonly conversationId: ConversationId
    readonly threadId: ThreadId
    readonly messageId: string
    readonly feedback: MessageFeedback | null
  }) => Promise<CanonicalMessageFeedback | null>
  readonly retry: (commandId: string) => Promise<CommandSuccess>
}

function newCommandId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID()
  throw new Error("当前运行环境不支持 crypto.randomUUID()")
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ConversationClientError({
      code: "invalid_response",
      message: "服务器返回了无法解析的响应",
      status: response.status,
    })
  }
}

function responseError(value: unknown, response: Response, commandId?: string) {
  const parsed = conversationErrorEnvelopeSchema.safeParse(value)
  if (!parsed.success)
    return new ConversationClientError({
      code: "invalid_response",
      message: `服务器返回 HTTP ${response.status}`,
      status: response.status,
      commandId,
    })
  return new ConversationClientError({
    ...parsed.data.error,
    status: response.status,
    commandId,
  })
}

export function createConversationClientGateway(input: {
  readonly store: NormalizedConversationStore
  readonly fetch?: FetchLike
}): ConversationClientGateway {
  const fetcher = input.fetch ?? globalThis.fetch.bind(globalThis)
  const pending = new Map<string, PendingRequest>()

  const loadConversation = async (targetConversationId: ConversationId) => {
    const response = await fetcher(`/api/conversations/${targetConversationId}`)
    const value = await responseJson(response)
    if (!response.ok) throw responseError(value, response)
    const data = parseConversationSnapshotQuery(value)
    input.store.installSnapshot(data)
  }

  const runPending = async (
    request: PendingRequest
  ): Promise<CommandSuccess> => {
    let response: Response
    try {
      response = await fetcher(request.url, request.init)
    } catch (cause) {
      if (request.mergeIntoCurrentStore)
        input.store.markCommandConfirming(request.commandId)
      throw new ConversationClientError({
        code: "network_uncertain",
        message: "网络中断，请使用同一命令重试以确认结果",
        commandId: request.commandId,
        uncertain: true,
        details: {
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      })
    }
    const value = await responseJson(response)
    if (!response.ok) {
      const error = responseError(value, response, request.commandId)
      if (response.status === 409 && request.mergeIntoCurrentStore) {
        try {
          await loadConversation(request.conversationId)
        } catch {
          input.store.markConversationStale(
            request.conversationId,
            "revision 冲突后的快照重取失败"
          )
        }
      }
      pending.delete(request.commandId)
      if (request.mergeIntoCurrentStore)
        input.store.failCommand(request.commandId, error.message)
      throw error
    }
    const result = parseCommandSuccess(value)
    pending.delete(request.commandId)
    if (request.mergeIntoCurrentStore) {
      const merged = input.store.mergeCommandResult(result)
      if (merged.requiresReload) await loadConversation(request.conversationId)
      input.store.resolveCommand(request.commandId)
    }
    return result
  }

  const command = (
    target: {
      readonly url: string
      readonly method: "POST" | "PATCH" | "DELETE"
      readonly conversationId: ConversationId
      readonly revisionScopeId?: string
      readonly body?: unknown
      readonly mergeIntoCurrentStore?: boolean
    },
    options: CommandOptions = {}
  ) => {
    const commandId = options.commandId ?? newCommandId()
    const headers = new Headers({
      "Content-Type": "application/json",
      "Idempotency-Key": commandId,
      "X-Command-Id": commandId,
    })
    if (target.revisionScopeId) {
      const revision = input.store.revisionOf(target.revisionScopeId)
      if (revision === undefined)
        throw new ConversationClientError({
          code: "revision_unavailable",
          message: `作用域 ${target.revisionScopeId} 尚无可用 revision`,
          commandId,
        })
      headers.set("If-Match", `"${revision}"`)
    }
    const request: PendingRequest = {
      commandId,
      conversationId: target.conversationId,
      mergeIntoCurrentStore: target.mergeIntoCurrentStore ?? true,
      url: target.url,
      init: {
        method: target.method,
        headers,
        ...(target.body === undefined
          ? {}
          : { body: JSON.stringify(target.body) }),
      },
    }
    pending.set(commandId, request)
    if (request.mergeIntoCurrentStore)
      input.store.beginCommand({
        commandId,
        kind: options.overlay?.kind ?? target.method.toLowerCase(),
        presentationKey: options.overlay?.presentationKey ?? commandId,
        status: "pending",
        ...(options.overlay?.threadId
          ? { threadId: options.overlay.threadId }
          : {}),
        ...(options.overlay?.draft !== undefined
          ? { draft: options.overlay.draft }
          : {}),
      })
    return runPending(request)
  }

  const queryGeneration = async (
    targetGenerationId: GenerationId,
    stop: boolean
  ) => {
    const response = await fetcher(
      `/api/generations/${targetGenerationId}${stop ? "/stop" : ""}`,
      stop ? { method: "POST" } : undefined
    )
    const value = await responseJson(response)
    if (!response.ok) throw responseError(value, response)
    const data = parseConversationQuery(value, generationQueryDataSchema)
    input.store.mergeGeneration(data.generation as CanonicalGenerationRecord)
    return data.generation as CanonicalGenerationRecord
  }

  return {
    async verifyAuthority(expected) {
      const response = await fetcher("/api/conversation-authority", {
        cache: "no-store",
      })
      const value = await responseJson(response)
      if (!response.ok) throw responseError(value, response)
      const actual = conversationAuthorityStateSchema.parse(value)
      if (
        actual.authority !== expected.authority ||
        actual.schemaVersion !== expected.schemaVersion ||
        actual.epoch !== expected.epoch
      )
        throw new ConversationClientError({
          code: "authority_mismatch",
          message: "客户端与服务端的 Conversation 权威版本不一致，请刷新页面",
          status: 409,
          details: { expected, actual },
        })
    },
    async listConversations(targetProjectId, includeArchived = false) {
      const response = await fetcher(
        `/api/projects/${targetProjectId}/conversations?includeArchived=${includeArchived}`
      )
      const value = await responseJson(response)
      if (!response.ok) throw responseError(value, response)
      return parseConversationQuery(value, conversationListQueryDataSchema)
        .conversations
    },
    loadConversation,
    createConversation: (targetProjectId, payload, options) =>
      command(
        {
          url: `/api/projects/${targetProjectId}/conversations`,
          method: "POST",
          conversationId: payload.conversationId,
          body: payload,
          // 这是跨聚合导航命令。返回 delta 属于新 Conversation，当前页面的
          // normalized store 必须保持单一 Conversation 身份，待路由切换后再加载。
          mergeIntoCurrentStore: false,
        },
        options
      ),
    renameConversation: (targetConversationId, payload, options) =>
      command(
        {
          url: `/api/conversations/${targetConversationId}`,
          method: "PATCH",
          conversationId: targetConversationId,
          revisionScopeId: targetConversationId,
          body: payload,
        },
        options
      ),
    archiveConversation: (targetConversationId, options) =>
      command(
        {
          url: `/api/conversations/${targetConversationId}`,
          method: "PATCH",
          conversationId: targetConversationId,
          revisionScopeId: targetConversationId,
          body: { lifecycle: "archived" },
        },
        options
      ),
    restoreConversation: (targetConversationId, options) =>
      command(
        {
          url: `/api/conversations/${targetConversationId}/restore`,
          method: "POST",
          conversationId: targetConversationId,
          revisionScopeId: targetConversationId,
        },
        options
      ),
    deleteConversation: (targetConversationId, options) =>
      command(
        {
          url: `/api/conversations/${targetConversationId}`,
          method: "DELETE",
          conversationId: targetConversationId,
          revisionScopeId: targetConversationId,
        },
        options
      ),
    renameThread: (targetThreadId, payload, options) => {
      const targetConversationId =
        input.store.getState().threadsById[targetThreadId]?.conversationId
      if (!targetConversationId) throw new Error("Thread 尚未加载")
      return command(
        {
          url: `/api/threads/${targetThreadId}`,
          method: "PATCH",
          conversationId: targetConversationId,
          revisionScopeId: targetThreadId,
          body: payload,
        },
        options
      )
    },
    archiveThread: (targetThreadId, options) => {
      const targetConversationId =
        input.store.getState().threadsById[targetThreadId]?.conversationId
      if (!targetConversationId) throw new Error("Thread 尚未加载")
      return command(
        {
          url: `/api/threads/${targetThreadId}`,
          method: "PATCH",
          conversationId: targetConversationId,
          revisionScopeId: targetThreadId,
          body: { lifecycle: "archived" },
        },
        options
      )
    },
    restoreThread: (targetThreadId, options) => {
      const targetConversationId =
        input.store.getState().threadsById[targetThreadId]?.conversationId
      if (!targetConversationId) throw new Error("Thread 尚未加载")
      return command(
        {
          url: `/api/threads/${targetThreadId}/restore`,
          method: "POST",
          conversationId: targetConversationId,
          revisionScopeId: targetThreadId,
        },
        options
      )
    },
    forkThread: (parentThreadId, payload, options) =>
      command(
        {
          url: `/api/threads/${parentThreadId}/forks`,
          method: "POST",
          conversationId: payload.conversationId,
          // Fork 改变 Conversation 拓扑，服务端并发边界是 Conversation revision。
          revisionScopeId: payload.conversationId,
          body: payload,
        },
        options
      ),
    sendTurn: (targetThreadId, payload, options) =>
      command(
        {
          url: `/api/threads/${targetThreadId}/turns`,
          method: "POST",
          conversationId: payload.conversationId,
          revisionScopeId: targetThreadId,
          body: payload,
        },
        options
      ),
    editTurnInput: (targetTurnId, payload, options) =>
      command(
        {
          url: `/api/turns/${targetTurnId}/input-edits`,
          method: "POST",
          conversationId: payload.conversationId,
          revisionScopeId: targetTurnId,
          body: payload,
        },
        options
      ),
    regenerateTurn: (targetTurnId, payload, options) =>
      command(
        {
          url: `/api/turns/${targetTurnId}/regenerations`,
          method: "POST",
          conversationId: payload.conversationId,
          revisionScopeId: targetTurnId,
          body: payload,
        },
        options
      ),
    selectTurnVariant: (targetTurnId, payload, options) =>
      command(
        {
          url: `/api/turns/${targetTurnId}/active-variant`,
          method: "POST",
          conversationId: payload.conversationId,
          revisionScopeId: targetTurnId,
          body: payload,
        },
        options
      ),
    getGeneration: (targetGenerationId) =>
      queryGeneration(targetGenerationId, false),
    stopGeneration: (targetGenerationId) =>
      queryGeneration(targetGenerationId, true),
    async listMessageFeedback(targetConversationId) {
      const response = await fetcher(
        `/api/conversations/${targetConversationId}/message-feedback`
      )
      const value = await responseJson(response)
      if (!response.ok) throw responseError(value, response)
      return canonicalMessageFeedbackListSchema.parse(value).feedback
    },
    async setMessageFeedback({
      conversationId: targetConversationId,
      threadId: targetThreadId,
      messageId: targetMessageId,
      feedback,
    }) {
      const response = await fetcher(
        `/api/conversations/${targetConversationId}/messages/${targetMessageId}/feedback`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId: targetThreadId, feedback }),
        }
      )
      const value = await responseJson(response)
      if (!response.ok) throw responseError(value, response)
      return setCanonicalMessageFeedbackResponseSchema.parse(value).feedback
    },
    retry(commandId) {
      const request = pending.get(commandId)
      if (!request)
        throw new ConversationClientError({
          code: "command_not_pending",
          message: "找不到可重试的命令",
          commandId,
        })
      input.store.markCommandConfirming(commandId)
      return runPending(request)
    },
  }
}
