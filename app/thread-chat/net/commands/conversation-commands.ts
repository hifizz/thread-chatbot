import type {
  AddProjectFileCommand,
  EditLatestTurnCommand,
  ForkThreadCommand,
  RemoveProjectFileCommand,
  RetryMessageCommand,
  SendMessageCommand,
  StartProjectCommand,
  UpdateProjectContractCommand,
} from "@/lib/thread-chat/contracts/commands"
import type {
  MessageDTO,
  ProjectDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import type {
  MessageContentInput,
  MessageContentPartInput,
} from "@/lib/thread-chat/contracts/message-content"
import { THREAD_QUOTE_SCHEMA_VERSION } from "@/lib/thread-chat/contracts/quote"
import type { ConversationStore } from "../../core/store"
import type { ConversationEntitySnapshot } from "../../core/types"
import { ThreadChatApiError, type ThreadChatClient } from "../client"
import {
  followAcceptedGeneration,
  type GenerationConnection,
} from "../stream/generation-connection"

export interface CommandFileReference {
  url: string
  mediaType: string
  filename?: string
}

export interface ConversationCommandOptions {
  store: ConversationStore
  client: ThreadChatClient
  fetch?: typeof globalThis.fetch
  createId?: () => string
  networkAttempts?: number
  pollDelays?: readonly number[]
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>
}

export interface ForkCommandInput {
  parentThreadId: string
  sourceMessageId: string
  anchorText: string
  anchor: TextAnchor
  modelId: string
  text?: string
  files?: CommandFileReference[]
}

function commandParts(
  text: string,
  files: CommandFileReference[]
): MessageContentPartInput[] {
  return [
    { type: "text", text },
    ...files.map((file) => ({ type: "file" as const, file })),
  ]
}

function userParts(content: MessageContentInput): MessageDTO["parts"] {
  return content.parts.map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text }
    if (part.type === "file") {
      return {
        type: "file" as const,
        url: part.file.url,
        mediaType: part.file.mediaType,
        ...(part.file.filename ? { filename: part.file.filename } : {}),
      }
    }
    return { type: "data-quote" as const, data: part.quote }
  })
}

function temporaryMessage(input: {
  id: string
  projectId: string
  threadId: string
  sequence: number
  role: "user" | "assistant"
  modelId?: string
  parts?: MessageDTO["parts"]
  replacesMessageId?: string | null
}): MessageDTO {
  const now = new Date().toISOString()
  return {
    id: input.id,
    projectId: input.projectId,
    threadId: input.threadId,
    sequence: input.sequence,
    role: input.role,
    parts: input.parts ?? [],
    status: input.role === "assistant" ? "generating" : "completed",
    modelId: input.modelId ?? null,
    replacesMessageId: input.replacesMessageId ?? null,
    supersededAt: null,
    feedback: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: input.role === "user" ? now : null,
  }
}

function nextSequence(
  snapshot: ConversationEntitySnapshot,
  threadId: string
): number {
  return (
    Math.max(
      0,
      ...(snapshot.messageIdsByThread[threadId] ?? []).map(
        (id) => snapshot.messagesById[id]?.sequence ?? 0
      )
    ) + 1
  )
}

function withMessages(
  snapshot: ConversationEntitySnapshot,
  rows: MessageDTO[]
): Partial<ConversationEntitySnapshot> {
  const messagesById = { ...snapshot.messagesById }
  const messageIdsByThread = { ...snapshot.messageIdsByThread }
  for (const row of rows) {
    messagesById[row.id] = row
    const ids = messageIdsByThread[row.threadId] ?? []
    messageIdsByThread[row.threadId] = ids.includes(row.id)
      ? ids
      : [...ids, row.id].sort(
          (left, right) =>
            (messagesById[left]?.sequence ?? 0) -
            (messagesById[right]?.sequence ?? 0)
        )
  }
  return { messagesById, messageIdsByThread }
}

function supersede(
  message: MessageDTO | undefined,
  at: string
): MessageDTO | undefined {
  return message ? { ...message, supersededAt: at, updatedAt: at } : undefined
}

function normalized(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function createConversationCommands(
  options: ConversationCommandOptions
) {
  const { store, client } = options
  const createId = options.createId ?? (() => crypto.randomUUID())
  const attempts = Math.max(1, options.networkAttempts ?? 2)
  const connections = new Map<string, GenerationConnection>()

  async function execute<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        if (error instanceof ThreadChatApiError || attempt === attempts - 1)
          throw error
      }
    }
    throw lastError
  }

  async function refreshProjectArtifacts(projectId: string) {
    try {
      const bootstrap = await client.getProject(projectId)
      if (bootstrap.project) store.getState().upsertProject(bootstrap.project)
      for (const artifact of bootstrap.artifacts)
        store.getState().upsertArtifact(artifact)
    } catch {
      // Artifact 资源区刷新是非阻塞增强；历史消息仍保留工具结果。
    }
  }

  function follow(
    accepted: Parameters<typeof followAcceptedGeneration>[0]["accepted"],
    afterFinish?: (threadId: string) => void | Promise<void>
  ) {
    connections.get(accepted.assistantMessage.id)?.close()
    const connection = followAcceptedGeneration({
      store,
      client,
      accepted,
      onFinishMessage: async (message) => {
        if (afterFinish) await afterFinish(message.threadId)
        await refreshProjectArtifacts(message.projectId)
      },
      fetch: options.fetch,
      pollDelays: options.pollDelays,
      wait: options.wait,
    })
    connections.set(connection.messageId, connection)
    void connection.finished.finally(() =>
      connections.delete(connection.messageId)
    )
    return connection
  }

  async function generateTitleIfNeeded(threadId: string) {
    const thread = store.getState().threadsById[threadId]
    if (!thread || thread.titleGenerationAttempted) return
    try {
      const response = await client.generateThreadTitle(threadId)
      store.getState().upsertProject(response.project)
      store.getState().upsertThread(response.thread)
    } catch {
      // 自动标题是非阻塞增强；失败保留现有回退标题，不影响消息流。
    }
  }

  async function startProject(input: {
    projectId: string
    rootThreadId?: string
    modelId: string
    text: string
    files?: CommandFileReference[]
  }) {
    const files = input.files ?? []
    const command: StartProjectCommand = Object.freeze({
      commandId: createId(),
      projectId: input.projectId,
      rootThreadId: input.rootThreadId ?? createId(),
      userMessageId: createId(),
      assistantMessageId: createId(),
      modelId: input.modelId,
      parts: commandParts(input.text, files),
    })
    const now = new Date().toISOString()
    const project: ProjectDTO = {
      id: command.projectId,
      rootThreadId: command.rootThreadId,
      autoTitle: null,
      customTitle: null,
      target: null,
      instructions: null,
      contractVersion: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const thread: ThreadDTO = {
      id: command.rootThreadId,
      projectId: command.projectId,
      parentId: null,
      forkMessageId: null,
      forkContext: [],
      forkAnchor: null,
      anchorText: null,
      footnote: null,
      depth: 0,
      modelId: command.modelId,
      autoTitle: null,
      customTitle: null,
      titleGenerationAttempted: false,
      titleGenerated: false,
      createdAt: now,
      updatedAt: now,
    }
    const user = temporaryMessage({
      id: command.userMessageId,
      projectId: project.id,
      threadId: thread.id,
      sequence: 1,
      role: "user",
      parts: userParts(command),
    })
    const assistant = temporaryMessage({
      id: command.assistantMessageId,
      projectId: project.id,
      threadId: thread.id,
      sequence: 2,
      role: "assistant",
      modelId: command.modelId,
    })
    store.getState().beginOptimisticCommand(command.commandId, () => ({
      project,
      projectFilesById: {},
      projectFileOrder: [],
      threadsById: { [thread.id]: thread },
      messagesById: { [user.id]: user, [assistant.id]: assistant },
      messageIdsByThread: { [thread.id]: [user.id, assistant.id] },
      artifactsById: {},
      artifactOrder: [],
      streamByMessageId: {},
    }))
    try {
      const response = await execute(() =>
        client.startProject(project.id, command)
      )
      store.getState().commitOptimisticCommand(command.commandId)
      const connection = follow(response.data)
      void generateTitleIfNeeded(command.rootThreadId)
      return { command, response, connection }
    } catch (error) {
      store.getState().rollbackOptimisticCommand(command.commandId)
      throw error
    }
  }

  async function sendMessage(input: {
    threadId: string
    modelId: string
    text: string
    files?: CommandFileReference[]
  }) {
    const state = store.getState()
    const project = state.project
    if (!project) throw new Error("Project 尚未加载")
    const files = input.files ?? []
    const command: SendMessageCommand = Object.freeze({
      commandId: createId(),
      userMessageId: createId(),
      assistantMessageId: createId(),
      modelId: input.modelId,
      parts: commandParts(input.text, files),
    })
    store.getState().beginOptimisticCommand(command.commandId, (snapshot) => {
      const sequence = nextSequence(snapshot, input.threadId)
      return withMessages(snapshot, [
        temporaryMessage({
          id: command.userMessageId,
          projectId: project.id,
          threadId: input.threadId,
          sequence,
          role: "user",
          parts: userParts(command),
        }),
        temporaryMessage({
          id: command.assistantMessageId,
          projectId: project.id,
          threadId: input.threadId,
          sequence: sequence + 1,
          role: "assistant",
          modelId: command.modelId,
        }),
      ])
    })
    try {
      const response = await execute(() =>
        client.sendMessage(input.threadId, command)
      )
      store.getState().commitOptimisticCommand(command.commandId)
      return {
        command,
        response,
        connection: follow(response.data, generateTitleIfNeeded),
      }
    } catch (error) {
      store.getState().rollbackOptimisticCommand(command.commandId)
      throw error
    }
  }

  async function forkThread(input: ForkCommandInput) {
    const state = store.getState()
    const project = state.project
    const parent = state.threadsById[input.parentThreadId]
    if (!project || !parent) throw new Error("来源会话尚未加载")
    const hasFirstTurn = Boolean(input.text?.trim())
    const files = input.files ?? []
    const command: ForkThreadCommand = Object.freeze({
      commandId: createId(),
      threadId: createId(),
      sourceMessageId: input.sourceMessageId,
      anchorText: input.anchorText,
      anchor: input.anchor,
      modelId: input.modelId,
      ...(hasFirstTurn
        ? {
            firstTurn: {
              userMessageId: createId(),
              assistantMessageId: createId(),
              parts: [
                {
                  type: "quote" as const,
                  quote: {
                    schemaVersion: THREAD_QUOTE_SCHEMA_VERSION,
                    text: input.anchorText,
                    source: {
                      type: "message" as const,
                      messageId: input.sourceMessageId,
                      anchor: input.anchor,
                    },
                  },
                },
                ...commandParts(input.text!.trim(), files),
              ],
            },
          }
        : {}),
    })
    const now = new Date().toISOString()
    store.getState().beginOptimisticCommand(command.commandId, (snapshot) => {
      const footnote =
        Math.max(
          0,
          ...Object.values(snapshot.threadsById).map(
            (thread) => thread.footnote ?? 0
          )
        ) + 1
      const thread: ThreadDTO = {
        id: command.threadId,
        projectId: project.id,
        parentId: parent.id,
        forkMessageId: command.sourceMessageId,
        forkContext: [],
        forkAnchor: command.anchor,
        anchorText: command.anchorText,
        footnote,
        depth: parent.depth + 1,
        modelId: command.modelId,
        autoTitle: null,
        customTitle: null,
        titleGenerationAttempted: false,
        titleGenerated: false,
        createdAt: now,
        updatedAt: now,
      }
      if (!command.firstTurn)
        return { threadsById: { ...snapshot.threadsById, [thread.id]: thread } }
      return {
        threadsById: { ...snapshot.threadsById, [thread.id]: thread },
        ...withMessages(snapshot, [
          temporaryMessage({
            id: command.firstTurn.userMessageId,
            projectId: project.id,
            threadId: thread.id,
            sequence: 1,
            role: "user",
            parts: userParts(command.firstTurn),
          }),
          temporaryMessage({
            id: command.firstTurn.assistantMessageId,
            projectId: project.id,
            threadId: thread.id,
            sequence: 2,
            role: "assistant",
            modelId: command.modelId,
          }),
        ]),
      }
    })
    try {
      const response = await execute(() =>
        client.forkThread(parent.id, command)
      )
      store.getState().commitOptimisticCommand(command.commandId)
      store.getState().upsertThread(response.data.thread)
      return {
        command,
        response,
        connection: response.data.generation
          ? follow(response.data.generation, generateTitleIfNeeded)
          : null,
      }
    } catch (error) {
      store.getState().rollbackOptimisticCommand(command.commandId)
      throw error
    }
  }

  async function retryMessage(input: { messageId: string; modelId: string }) {
    const source = store.getState().messagesById[input.messageId]
    if (!source) throw new Error("回复尚未加载")
    const command: RetryMessageCommand = Object.freeze({
      commandId: createId(),
      assistantMessageId: createId(),
      modelId: input.modelId,
    })
    store.getState().beginOptimisticCommand(command.commandId, (snapshot) => {
      const now = new Date().toISOString()
      const old = supersede(snapshot.messagesById[source.id], now)!
      const replacement = temporaryMessage({
        id: command.assistantMessageId,
        projectId: source.projectId,
        threadId: source.threadId,
        sequence: nextSequence(snapshot, source.threadId),
        role: "assistant",
        modelId: command.modelId,
        replacesMessageId: source.id,
      })
      const partial = withMessages(snapshot, [replacement])
      return {
        ...partial,
        messagesById: { ...partial.messagesById!, [old.id]: old },
      }
    })
    try {
      const response = await execute(() =>
        client.retryMessage(source.id, command)
      )
      store.getState().commitOptimisticCommand(command.commandId)
      return {
        command,
        response,
        connection: follow(response.data, generateTitleIfNeeded),
      }
    } catch (error) {
      store.getState().rollbackOptimisticCommand(command.commandId)
      throw error
    }
  }

  async function editLatestTurn(input: {
    userMessageId: string
    assistantMessageId?: string
    modelId: string
    text: string
    files?: CommandFileReference[]
  }) {
    const source = store.getState().messagesById[input.userMessageId]
    if (!source) throw new Error("原消息尚未加载")
    const files = input.files ?? []
    const command: EditLatestTurnCommand = Object.freeze({
      commandId: createId(),
      userMessageId: createId(),
      assistantMessageId: createId(),
      modelId: input.modelId,
      parts: commandParts(input.text, files),
    })
    store.getState().beginOptimisticCommand(command.commandId, (snapshot) => {
      const now = new Date().toISOString()
      const messagesById = { ...snapshot.messagesById }
      messagesById[source.id] = supersede(messagesById[source.id], now)!
      if (input.assistantMessageId && messagesById[input.assistantMessageId])
        messagesById[input.assistantMessageId] = supersede(
          messagesById[input.assistantMessageId],
          now
        )!
      const sequence = nextSequence(snapshot, source.threadId)
      const partial = withMessages({ ...snapshot, messagesById }, [
        temporaryMessage({
          id: command.userMessageId,
          projectId: source.projectId,
          threadId: source.threadId,
          sequence,
          role: "user",
          parts: userParts(command),
          replacesMessageId: source.id,
        }),
        temporaryMessage({
          id: command.assistantMessageId,
          projectId: source.projectId,
          threadId: source.threadId,
          sequence: sequence + 1,
          role: "assistant",
          modelId: command.modelId,
          replacesMessageId: input.assistantMessageId ?? null,
        }),
      ])
      return {
        ...partial,
        messagesById: { ...messagesById, ...partial.messagesById },
      }
    })
    try {
      const response = await execute(() =>
        client.editMessage(source.id, command)
      )
      store.getState().commitOptimisticCommand(command.commandId)
      return {
        command,
        response,
        connection: follow(response.data.generation, generateTitleIfNeeded),
      }
    } catch (error) {
      store.getState().rollbackOptimisticCommand(command.commandId)
      throw error
    }
  }

  async function stopMessage(messageId: string) {
    const command = Object.freeze({ commandId: createId() })
    const response = await execute(() => client.stopMessage(messageId, command))
    store.getState().upsertMessage(response.data)
    return { command, response }
  }

  async function setFeedback(
    messageId: string,
    feedback: "up" | "down" | null
  ) {
    const command = Object.freeze({ commandId: createId(), feedback })
    const current = store.getState().messagesById[messageId]
    if (!current) throw new Error("回复尚未加载")
    store.getState().beginOptimisticCommand(command.commandId, (snapshot) => ({
      messagesById: {
        ...snapshot.messagesById,
        [messageId]: { ...current, feedback },
      },
    }))
    try {
      const response = await execute(() =>
        client.setFeedback(messageId, command)
      )
      store.getState().commitOptimisticCommand(command.commandId)
      store.getState().upsertMessage(response.data)
      return { command, response }
    } catch (error) {
      store.getState().rollbackOptimisticCommand(command.commandId)
      throw error
    }
  }

  async function updateThread(
    threadId: string,
    update: { modelId?: string; customTitle?: string | null }
  ) {
    const command = Object.freeze({ commandId: createId(), ...update })
    const response = await execute(() => client.updateThread(threadId, command))
    store.getState().upsertThread(response.data)
    return { command, response }
  }

  async function renameProject(projectId: string, customTitle: string) {
    const command = Object.freeze({ commandId: createId(), customTitle })
    const response = await execute(() =>
      client.renameProject(projectId, command)
    )
    store.getState().upsertProject(response.data)
    const root = store.getState().threadsById[response.data.rootThreadId]
    if (root) store.getState().upsertThread({ ...root, customTitle })
    return { command, response }
  }

  async function updateProjectContract(input: {
    projectId: string
    target: string
    instructions: string
    expectedContractVersion?: number
  }) {
    const current = store.getState().project
    if (!current || current.id !== input.projectId)
      throw new Error("Project 尚未加载")
    const command: UpdateProjectContractCommand = Object.freeze({
      commandId: createId(),
      expectedContractVersion:
        input.expectedContractVersion ?? current.contractVersion,
      target: input.target,
      instructions: input.instructions,
    })
    const optimistic: ProjectDTO = {
      ...current,
      target: normalized(input.target),
      instructions: normalized(input.instructions),
      contractVersion: current.contractVersion + 1,
      updatedAt: new Date().toISOString(),
    }
    store.getState().beginOptimisticCommand(command.commandId, () => ({
      project: optimistic,
    }))
    try {
      const response = await execute(() =>
        client.updateProjectContract(input.projectId, command)
      )
      store.getState().commitOptimisticCommand(command.commandId)
      store.getState().upsertProject(response.data)
      return { command, response }
    } catch (error) {
      store.getState().rollbackOptimisticCommand(command.commandId)
      throw error
    }
  }

  async function addProjectFile(attachmentId: string) {
    const project = store.getState().project
    if (!project) throw new Error("Project 尚未加载")
    const command: AddProjectFileCommand = Object.freeze({
      commandId: createId(),
      attachmentId,
    })
    const response = await execute(() =>
      client.addProjectFile(project.id, command)
    )
    store.getState().upsertProjectFile(response.data)
    return { command, response }
  }

  async function removeProjectFile(attachmentId: string) {
    const project = store.getState().project
    if (!project) throw new Error("Project 尚未加载")
    const command: RemoveProjectFileCommand = Object.freeze({
      commandId: createId(),
      attachmentId,
    })
    const response = await execute(() =>
      client.removeProjectFile(project.id, attachmentId, command)
    )
    store.getState().removeProjectFile(attachmentId)
    return { command, response }
  }

  async function setProjectArchived(projectId: string, archived: boolean) {
    const command = Object.freeze({ commandId: createId(), archived })
    const response = await execute(() =>
      client.setProjectArchived(projectId, command)
    )
    store.getState().upsertProject(response.data)
    return { command, response }
  }

  async function deleteProject(projectId: string) {
    const command = Object.freeze({ commandId: createId() })
    const response = await execute(() =>
      client.deleteProject(projectId, command)
    )
    store.getState().removeProject(projectId)
    for (const connection of connections.values()) connection.close()
    connections.clear()
    return { command, response }
  }

  return {
    startProject,
    sendMessage,
    forkThread,
    retryMessage,
    editLatestTurn,
    stopMessage,
    setFeedback,
    updateThread,
    renameProject,
    updateProjectContract,
    addProjectFile,
    removeProjectFile,
    setProjectArchived,
    deleteProject,
    dispose() {
      for (const connection of connections.values()) connection.close()
      connections.clear()
    },
  }
}

export type ConversationCommands = ReturnType<typeof createConversationCommands>
