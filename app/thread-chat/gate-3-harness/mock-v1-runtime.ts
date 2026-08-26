import type {
  ArtifactDTO,
  GenerationAcceptedDTO,
  MessageDTO,
  ProjectBootstrapDTO,
  ProjectDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type { ThreadChatClient } from "../net/client"

export type Gate3HarnessScenario =
  "normal" | "late-sse" | "disconnect" | "failure" | "artifact" | "research"

const ROOT_THREAD_ID = "00000000-0000-4000-8000-000000000010"
const CHILD_THREAD_ID = "00000000-0000-4000-8000-000000000020"
const NESTED_THREAD_ID = "00000000-0000-4000-8000-000000000030"
const ROOT_USER_ID = "00000000-0000-4000-8000-000000000101"
const ROOT_ASSISTANT_ID = "00000000-0000-4000-8000-000000000102"
const CHILD_USER_ID = "00000000-0000-4000-8000-000000000201"
const CHILD_ASSISTANT_ID = "00000000-0000-4000-8000-000000000202"
const INITIAL_ARTIFACT_ID = "00000000-0000-4000-8000-000000000401"
const BACKGROUND_USER_ID = "00000000-0000-4000-8000-000000000501"
const BACKGROUND_ASSISTANT_ID = "00000000-0000-4000-8000-000000000502"
const MODEL_ID = "doubao-seed-2.1-turbo"

function clone<T>(value: T): T {
  return structuredClone(value)
}

function now(): string {
  return new Date().toISOString()
}

function textOf(message: MessageDTO): string {
  return message.parts
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("")
}

function commandResponse<T>(data: T) {
  return { ok: true as const, replayed: false, data }
}

function initialBootstrap(
  projectId: string,
  options: { backgroundRecovery?: boolean } = {}
): ProjectBootstrapDTO {
  const stamp = now()
  const project: ProjectDTO = {
    id: projectId,
    rootThreadId: ROOT_THREAD_ID,
    autoTitle: "规范化会话验收",
    customTitle: null,
    archivedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  }
  const root: ThreadDTO = {
    id: ROOT_THREAD_ID,
    projectId,
    parentId: null,
    forkMessageId: null,
    forkContext: [],
    forkAnchor: null,
    anchorText: null,
    footnote: null,
    depth: 0,
    modelId: MODEL_ID,
    autoTitle: "规范化会话验收",
    customTitle: null,
    titleGenerationAttempted: true,
    titleGenerated: true,
    createdAt: stamp,
    updatedAt: stamp,
  }
  const child: ThreadDTO = {
    id: CHILD_THREAD_ID,
    projectId,
    parentId: ROOT_THREAD_ID,
    forkMessageId: ROOT_ASSISTANT_ID,
    forkContext: [ROOT_USER_ID, ROOT_ASSISTANT_ID],
    forkAnchor: {
      quote: {
        exact: "HTTP 连接断开不能拥有模型任务",
        prefix: "关键原则是：",
        suffix: "。这使刷新和断流都可恢复。",
      },
    },
    anchorText: "HTTP 连接断开不能拥有模型任务",
    footnote: 1,
    depth: 1,
    modelId: MODEL_ID,
    autoTitle: "断流恢复",
    customTitle: null,
    titleGenerationAttempted: true,
    titleGenerated: true,
    createdAt: stamp,
    updatedAt: stamp,
  }
  const nested: ThreadDTO = {
    id: NESTED_THREAD_ID,
    projectId,
    parentId: CHILD_THREAD_ID,
    forkMessageId: CHILD_ASSISTANT_ID,
    forkContext: [
      ROOT_USER_ID,
      ROOT_ASSISTANT_ID,
      CHILD_USER_ID,
      CHILD_ASSISTANT_ID,
    ],
    forkAnchor: {
      quote: {
        exact: "只轮询，不重新连接 SSE",
        prefix: "刷新后",
        suffix: "。",
      },
    },
    anchorText: "只轮询，不重新连接 SSE",
    footnote: 2,
    depth: 2,
    modelId: MODEL_ID,
    autoTitle: "后台轮询",
    customTitle: null,
    titleGenerationAttempted: true,
    titleGenerated: true,
    createdAt: stamp,
    updatedAt: stamp,
  }
  const messages: MessageDTO[] = [
    {
      id: ROOT_USER_ID,
      projectId,
      threadId: ROOT_THREAD_ID,
      sequence: 1,
      role: "user",
      parts: [{ type: "text", text: "说明新会话架构为什么能应对断流。" }],
      status: "completed",
      modelId: null,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    },
    {
      id: ROOT_ASSISTANT_ID,
      projectId,
      threadId: ROOT_THREAD_ID,
      sequence: 2,
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "先区分模型任务、SSE 连接和数据库终态。",
          state: "done",
        },
        {
          type: "text",
          text: "关键原则是：HTTP 连接断开不能拥有模型任务。这使刷新和断流都可恢复。",
          state: "done",
        },
        {
          type: "data-research-activity",
          id: "research-initial",
          data: {
            toolCallId: "search-initial",
            kind: "search",
            status: "complete",
            query: "AI SDK UI Message stream",
            sources: [{ title: "AI SDK", url: "https://ai-sdk.dev/docs" }],
          },
        },
        {
          type: "source-url",
          sourceId: "source-initial",
          url: "https://ai-sdk.dev/docs",
          title: "AI SDK 文档",
        },
      ],
      status: "completed",
      modelId: MODEL_ID,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    },
    {
      id: CHILD_USER_ID,
      projectId,
      threadId: CHILD_THREAD_ID,
      sequence: 1,
      role: "user",
      parts: [{ type: "text", text: "刷新后具体怎么处理？" }],
      status: "completed",
      modelId: null,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    },
    {
      id: CHILD_ASSISTANT_ID,
      projectId,
      threadId: CHILD_THREAD_ID,
      sequence: 2,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "刷新后只轮询，不重新连接 SSE；终态返回后再一次性收敛完整 parts。",
          state: "done",
        },
      ],
      status: "completed",
      modelId: MODEL_ID,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    },
  ]
  if (options.backgroundRecovery) {
    messages.push(
      {
        id: BACKGROUND_USER_ID,
        projectId,
        threadId: ROOT_THREAD_ID,
        sequence: 3,
        role: "user",
        parts: [{ type: "text", text: "刷新后恢复后台生成" }],
        status: "completed",
        modelId: null,
        replacesMessageId: null,
        supersededAt: null,
        feedback: null,
        error: null,
        createdAt: stamp,
        updatedAt: stamp,
        finishedAt: stamp,
      },
      {
        id: BACKGROUND_ASSISTANT_ID,
        projectId,
        threadId: ROOT_THREAD_ID,
        sequence: 4,
        role: "assistant",
        parts: [
          { type: "text", text: "刷新前 checkpoint", state: "streaming" },
        ],
        status: "generating",
        modelId: MODEL_ID,
        replacesMessageId: null,
        supersededAt: null,
        feedback: null,
        error: null,
        createdAt: stamp,
        updatedAt: stamp,
        finishedAt: null,
      }
    )
  }
  const artifact: ArtifactDTO = {
    id: INITIAL_ARTIFACT_ID,
    projectId,
    sourceMessageId: ROOT_ASSISTANT_ID,
    kind: "markdown",
    title: "断流恢复验收清单",
    content:
      "# 断流恢复验收清单\n\n- 模型任务独立于 HTTP\n- SSE 只连接一次\n- 断开后轮询终态",
    language: null,
    metadata: {},
    createdAt: stamp,
    updatedAt: stamp,
  }
  return {
    project,
    threads: [root, child, nested],
    messages,
    artifacts: [artifact],
    activeGenerationIds: options.backgroundRecovery
      ? [BACKGROUND_ASSISTANT_ID]
      : [],
  }
}

export function createGate3MockRuntime(
  projectId: string,
  options: { backgroundRecovery?: boolean } = {}
) {
  const seed = initialBootstrap(projectId, options)
  let project = clone(seed.project)
  const threads = new Map(
    seed.threads.map((thread) => [thread.id, clone(thread)])
  )
  const messages = new Map(
    seed.messages.map((message) => [message.id, clone(message)])
  )
  const artifacts = new Map(
    seed.artifacts.map((artifact) => [artifact.id, clone(artifact)])
  )
  const scenarioByMessageId = new Map<string, Gate3HarnessScenario>()
  const backgroundPolls = new Map<string, number>()
  for (const messageId of seed.activeGenerationIds)
    scenarioByMessageId.set(messageId, "normal")
  let selectedScenario: Gate3HarnessScenario = "normal"

  const bootstrap = (): ProjectBootstrapDTO => ({
    project: clone(project),
    threads: [...threads.values()].map(clone),
    messages: [...messages.values()].map(clone),
    artifacts: [...artifacts.values()].map(clone),
    activeGenerationIds: [...messages.values()]
      .filter((message) => message.status === "generating")
      .map((message) => message.id),
  })

  const nextSequence = (threadId: string) =>
    Math.max(
      0,
      ...[...messages.values()]
        .filter((message) => message.threadId === threadId)
        .map((message) => message.sequence)
    ) + 1

  const makeUser = (input: {
    id: string
    threadId: string
    sequence: number
    text: string
  }): MessageDTO => {
    const stamp = now()
    return {
      id: input.id,
      projectId,
      threadId: input.threadId,
      sequence: input.sequence,
      role: "user",
      parts: [{ type: "text", text: input.text }],
      status: "completed",
      modelId: null,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    }
  }

  const makeAssistant = (input: {
    id: string
    threadId: string
    sequence: number
    modelId: string
    replacesMessageId?: string | null
  }): MessageDTO => {
    const stamp = now()
    return {
      id: input.id,
      projectId,
      threadId: input.threadId,
      sequence: input.sequence,
      role: "assistant",
      parts: [],
      status: "generating",
      modelId: input.modelId,
      replacesMessageId: input.replacesMessageId ?? null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: null,
    }
  }

  const accepted = (
    thread: ThreadDTO,
    assistantMessage: MessageDTO,
    userMessage?: MessageDTO
  ): GenerationAcceptedDTO => ({
    project: clone(project!),
    thread: clone(thread),
    ...(userMessage ? { userMessage: clone(userMessage) } : {}),
    assistantMessage: clone(assistantMessage),
    streamUrl: `mock://thread-chat/${assistantMessage.id}`,
  })

  const finalMessage = (messageId: string): MessageDTO => {
    const current = messages.get(messageId)
    if (!current) throw new Error("MESSAGE_NOT_FOUND")
    if (current.status !== "generating") return clone(current)
    const scenario = scenarioByMessageId.get(messageId) ?? "normal"
    const stamp = now()
    let parts: MessageDTO["parts"] = [
      {
        type: "text",
        text: `已通过 ${scenario} 场景完成规范化 parts 收敛。`,
        state: "done",
      },
    ]
    let status: MessageDTO["status"] = "completed"
    let error: MessageDTO["error"] = null
    if (scenario === "failure") {
      status = "failed"
      error = { code: "HARNESS_FAILURE", message: "可控失败：请使用重新生成" }
      parts = [{ type: "text", text: "失败前保留的部分内容", state: "done" }]
    } else if (scenario === "artifact") {
      const artifactId = crypto.randomUUID()
      artifacts.set(artifactId, {
        id: artifactId,
        projectId,
        sourceMessageId: messageId,
        kind: "markdown",
        title: "Gate 3 生成报告",
        content:
          "# Gate 3 生成报告\n\nArtifact 已通过 tool output ID 拉取并写入 Store。",
        language: null,
        metadata: {},
        createdAt: stamp,
        updatedAt: stamp,
      })
      parts = [
        {
          type: "tool-createMarkdownArtifact",
          toolCallId: `artifact-${messageId}`,
          state: "output-available",
          input: {
            title: "Gate 3 生成报告",
            content: "# Gate 3 生成报告",
          },
          output: { created: true, artifactId },
        },
      ]
    } else if (scenario === "research") {
      parts = [
        {
          type: "text",
          text: "研究流程已完成，并保留来源与结构化活动。",
          state: "done",
        },
        {
          type: "data-research-activity",
          id: `research-${messageId}`,
          data: {
            toolCallId: `search-${messageId}`,
            kind: "search",
            status: "complete",
            query: "AI SDK v7 UI Message",
            sources: [{ title: "AI SDK", url: "https://ai-sdk.dev/docs" }],
          },
        },
        {
          type: "source-url",
          sourceId: `source-${messageId}`,
          url: "https://ai-sdk.dev/docs",
          title: "AI SDK 文档",
        },
      ]
    }
    const terminal: MessageDTO = {
      ...current,
      parts,
      status,
      error,
      updatedAt: stamp,
      finishedAt: stamp,
    }
    messages.set(messageId, terminal)
    return clone(terminal)
  }

  const client: ThreadChatClient = {
    async listProjects(archived = false) {
      return project && Boolean(project.archivedAt) === archived
        ? [clone(project)]
        : []
    },
    async getProject() {
      return bootstrap()
    },
    async getMessage(messageId) {
      const message = messages.get(messageId)
      if (!message) throw new Error("MESSAGE_NOT_FOUND")
      if (
        seed.activeGenerationIds.includes(messageId) &&
        message.status === "generating"
      ) {
        const count = (backgroundPolls.get(messageId) ?? 0) + 1
        backgroundPolls.set(messageId, count)
        if (count >= 2) return finalMessage(messageId)
      }
      return clone(message)
    },
    async getArtifact(artifactId) {
      const artifact = artifacts.get(artifactId)
      if (!artifact) throw new Error("ARTIFACT_NOT_FOUND")
      return clone(artifact)
    },
    async startProject(_requestedProjectId, input) {
      if (!project) {
        const stamp = now()
        project = {
          id: input.projectId,
          rootThreadId: input.rootThreadId,
          autoTitle: null,
          customTitle: null,
          archivedAt: null,
          createdAt: stamp,
          updatedAt: stamp,
        }
      }
      const thread = threads.get(project.rootThreadId)!
      const user = makeUser({
        id: input.userMessageId,
        threadId: thread.id,
        sequence: nextSequence(thread.id),
        text: input.text,
      })
      const assistant = makeAssistant({
        id: input.assistantMessageId,
        threadId: thread.id,
        sequence: user.sequence + 1,
        modelId: input.modelId,
      })
      messages.set(user.id, user)
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse(accepted(thread, assistant, user))
    },
    async sendMessage(threadId, input) {
      const thread = threads.get(threadId)
      if (!thread) throw new Error("THREAD_NOT_FOUND")
      const user = makeUser({
        id: input.userMessageId,
        threadId,
        sequence: nextSequence(threadId),
        text: input.text,
      })
      const assistant = makeAssistant({
        id: input.assistantMessageId,
        threadId,
        sequence: user.sequence + 1,
        modelId: input.modelId,
      })
      messages.set(user.id, user)
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse(accepted(thread, assistant, user))
    },
    async forkThread(parentThreadId, input) {
      const parent = threads.get(parentThreadId)
      if (!parent) throw new Error("THREAD_NOT_FOUND")
      const stamp = now()
      const thread: ThreadDTO = {
        id: input.threadId,
        projectId,
        parentId: parentThreadId,
        forkMessageId: input.sourceMessageId,
        forkContext: [],
        forkAnchor: input.anchor,
        anchorText: input.anchorText,
        footnote:
          Math.max(
            0,
            ...[...threads.values()].map((row) => row.footnote ?? 0)
          ) + 1,
        depth: parent.depth + 1,
        modelId: input.modelId,
        autoTitle: input.anchorText.slice(0, 13),
        customTitle: null,
        titleGenerationAttempted: false,
        titleGenerated: false,
        createdAt: stamp,
        updatedAt: stamp,
      }
      threads.set(thread.id, thread)
      if (!input.firstTurn)
        return commandResponse({ thread: clone(thread), generation: null })
      const user = makeUser({
        id: input.firstTurn.userMessageId,
        threadId: thread.id,
        sequence: 1,
        text: input.firstTurn.text,
      })
      const assistant = makeAssistant({
        id: input.firstTurn.assistantMessageId,
        threadId: thread.id,
        sequence: 2,
        modelId: input.modelId,
      })
      messages.set(user.id, user)
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse({
        thread: clone(thread),
        generation: accepted(thread, assistant, user),
      })
    },
    async editMessage(userMessageId, input) {
      const source = messages.get(userMessageId)
      if (!source) throw new Error("MESSAGE_NOT_FOUND")
      const stamp = now()
      source.supersededAt = stamp
      source.updatedAt = stamp
      const oldAssistant = [...messages.values()]
        .filter(
          (message) =>
            message.threadId === source.threadId &&
            message.role === "assistant" &&
            message.sequence > source.sequence &&
            message.supersededAt === null
        )
        .sort((left, right) => left.sequence - right.sequence)[0]
      if (oldAssistant) {
        oldAssistant.supersededAt = stamp
        oldAssistant.updatedAt = stamp
      }
      const user = makeUser({
        id: input.userMessageId,
        threadId: source.threadId,
        sequence: nextSequence(source.threadId),
        text: input.text,
      })
      user.replacesMessageId = source.id
      const assistant = makeAssistant({
        id: input.assistantMessageId,
        threadId: source.threadId,
        sequence: user.sequence + 1,
        modelId: input.modelId,
        replacesMessageId: oldAssistant?.id ?? null,
      })
      messages.set(user.id, user)
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse({
        generation: accepted(threads.get(source.threadId)!, assistant, user),
        abortMessageId:
          oldAssistant?.status === "generating" ? oldAssistant.id : null,
      })
    },
    async retryMessage(messageId, input) {
      const source = messages.get(messageId)
      if (!source) throw new Error("MESSAGE_NOT_FOUND")
      const stamp = now()
      source.supersededAt = stamp
      source.updatedAt = stamp
      const assistant = makeAssistant({
        id: input.assistantMessageId,
        threadId: source.threadId,
        sequence: nextSequence(source.threadId),
        modelId: input.modelId,
        replacesMessageId: source.id,
      })
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse(accepted(threads.get(source.threadId)!, assistant))
    },
    async stopMessage(messageId) {
      const message = messages.get(messageId)
      if (!message) throw new Error("MESSAGE_NOT_FOUND")
      if (message.status === "generating") {
        const stamp = now()
        messages.set(messageId, {
          ...message,
          status: "stopped",
          updatedAt: stamp,
          finishedAt: stamp,
        })
      }
      return commandResponse(clone(messages.get(messageId)!))
    },
    async setFeedback(messageId, input) {
      const message = messages.get(messageId)
      if (!message) throw new Error("MESSAGE_NOT_FOUND")
      const updated = { ...message, feedback: input.feedback, updatedAt: now() }
      messages.set(messageId, updated)
      return commandResponse(clone(updated))
    },
    async updateThread(threadId, input) {
      const thread = threads.get(threadId)
      if (!thread) throw new Error("THREAD_NOT_FOUND")
      const updated = {
        ...thread,
        ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
        ...(input.customTitle !== undefined
          ? { customTitle: input.customTitle }
          : {}),
        updatedAt: now(),
      }
      threads.set(threadId, updated)
      return commandResponse(clone(updated))
    },
    async renameProject(_targetProjectId, input) {
      if (!project) throw new Error("PROJECT_NOT_FOUND")
      project = { ...project, customTitle: input.customTitle, updatedAt: now() }
      return commandResponse(clone(project))
    },
    async setProjectArchived(_targetProjectId, input) {
      if (!project) throw new Error("PROJECT_NOT_FOUND")
      project = {
        ...project,
        archivedAt: input.archived ? now() : null,
        updatedAt: now(),
      }
      return commandResponse(clone(project))
    },
    async deleteProject() {
      project = null
      threads.clear()
      messages.clear()
      artifacts.clear()
      return commandResponse({ projectId, deleted: true as const })
    },
  }

  const fetchStream: typeof globalThis.fetch = async (input) => {
    const messageId = String(input).split("/").at(-1) ?? ""
    const scenario = scenarioByMessageId.get(messageId) ?? "normal"
    const encoder = new TextEncoder()
    let disconnected = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => {
          if (disconnected) return
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          )
        }
        const close = () => {
          if (disconnected) return
          disconnected = true
          controller.close()
        }
        const startDelay = scenario === "late-sse" ? 700 : 20
        setTimeout(() => {
          const current = messages.get(messageId)
          if (!current) return close()
          if (current.status !== "generating") {
            send({ type: "terminal", message: clone(current) })
            close()
            return
          }
          send({
            type: "snapshot",
            message: { id: messageId, role: "assistant", parts: [] },
            throughSeq: 0,
            replay: [],
          })
          send({
            type: "chunk",
            seq: 1,
            chunk: { type: "text-start", id: "text" },
          })
          send({
            type: "chunk",
            seq: 2,
            chunk: {
              type: "text-delta",
              id: "text",
              delta: "正在验证规范化流…",
            },
          })
          if (scenario === "disconnect") {
            close()
            setTimeout(() => {
              if (messages.get(messageId)?.status === "generating")
                finalMessage(messageId)
            }, 180)
            return
          }
          setTimeout(() => {
            const currentMessage = messages.get(messageId)
            if (!currentMessage) return close()
            const terminal =
              currentMessage.status === "generating"
                ? finalMessage(messageId)
                : clone(currentMessage)
            send({
              type: "chunk",
              seq: 3,
              chunk: { type: "text-end", id: "text" },
            })
            send({ type: "terminal", message: terminal })
            close()
          }, 500)
        }, startDelay)
      },
      cancel() {
        disconnected = true
      },
    })
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  return {
    bootstrap: seed,
    client,
    fetchStream,
    setScenario(scenario: Gate3HarnessScenario) {
      selectedScenario = scenario
    },
    getScenario() {
      return selectedScenario
    },
    describeMessage(messageId: string) {
      const message = messages.get(messageId)
      return message ? `${message.status}: ${textOf(message)}` : "missing"
    },
  }
}

export const GATE3_HARNESS_IDS = {
  rootThreadId: ROOT_THREAD_ID,
  childThreadId: CHILD_THREAD_ID,
  nestedThreadId: NESTED_THREAD_ID,
} as const
