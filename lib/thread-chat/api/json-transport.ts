import { z } from "zod"
import { ThreadChatClientError } from "./client-error"
import type { ThreadChatApiCapabilities } from "./capabilities"
import {
  apiErrorResponseSchema,
  apiResponseSchema,
  artifactSchema,
  assistantMessageEventSchema,
  assistantRunStateSchema,
  creationBundleSchema,
  feedbackSchema,
  listProjectsResultSchema,
  messageCreationBundleSchema,
  projectBootstrapSchema,
  projectSchema,
  replacementBundleSchema,
  threadMessageBundleSchema,
  threadSchema,
} from "./contracts"
import { threadChatApiRoutes } from "./routes"

type RequestOptions<T> = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  signal?: AbortSignal
  schema: z.ZodType<T>
}

export class JsonThreadChatTransport implements ThreadChatApiCapabilities {
  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly baseUrl = ""
  ) {}

  listProjects(input: Parameters<ThreadChatApiCapabilities["listProjects"]>[0] = {}) {
    const query = new URLSearchParams()
    if (input.status) query.set("status", input.status)
    if (input.limit !== undefined) query.set("limit", String(input.limit))
    if (input.cursor) query.set("cursor", input.cursor)
    return this.request(
      `${threadChatApiRoutes.projects()}${query.size ? `?${query}` : ""}`,
      { schema: listProjectsResultSchema, signal: input.signal }
    )
  }

  createProject(input: Parameters<ThreadChatApiCapabilities["createProject"]>[0]) {
    return this.request(threadChatApiRoutes.projects(), {
      method: "POST",
      body: {
        initialMessage: { parts: input.parts },
        ...(input.requestedModelId
          ? { requestedModelId: input.requestedModelId }
          : {}),
      },
      schema: creationBundleSchema,
      signal: input.signal,
    })
  }

  bootstrapProject(projectId: string, signal?: AbortSignal) {
    return this.request(threadChatApiRoutes.projectBootstrap(projectId), {
      schema: projectBootstrapSchema,
      signal,
    })
  }

  patchProject(input: Parameters<ThreadChatApiCapabilities["patchProject"]>[0]) {
    const { projectId, ...body } = input
    return this.request(threadChatApiRoutes.project(projectId), {
      method: "PATCH",
      body,
      schema: projectSchema,
    })
  }

  setProjectArchived(projectId: string, archived: boolean) {
    return this.request(threadChatApiRoutes.projectArchive(projectId, archived), {
      method: "POST",
      schema: projectSchema,
    })
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.requestEmpty(threadChatApiRoutes.project(projectId), "DELETE")
  }

  loadThreadMessages(input: Parameters<ThreadChatApiCapabilities["loadThreadMessages"]>[0]) {
    const query = new URLSearchParams()
    if (input.limit !== undefined) query.set("limit", String(input.limit))
    if (input.beforeSequence !== undefined)
      query.set("beforeSequence", String(input.beforeSequence))
    return this.request(
      `${threadChatApiRoutes.threadMessages(input.threadId)}${query.size ? `?${query}` : ""}`,
      { schema: threadMessageBundleSchema, signal: input.signal }
    )
  }

  patchThread(threadId: string, customTitle: string | null) {
    return this.request(threadChatApiRoutes.thread(threadId), {
      method: "PATCH",
      body: { customTitle },
      schema: threadSchema,
    })
  }

  setThreadArchived(threadId: string, archived: boolean) {
    return this.request(threadChatApiRoutes.threadArchive(threadId, archived), {
      method: "POST",
      schema: threadSchema,
    })
  }

  sendMessage(input: Parameters<ThreadChatApiCapabilities["sendMessage"]>[0]) {
    return this.request(threadChatApiRoutes.threadMessages(input.threadId), {
      method: "POST",
      body: {
        parts: input.parts,
        ...(input.requestedModelId
          ? { requestedModelId: input.requestedModelId }
          : {}),
      },
      schema: messageCreationBundleSchema,
    })
  }

  forkThread(
    threadId: string,
    input: Parameters<ThreadChatApiCapabilities["forkThread"]>[1]
  ) {
    return this.request(threadChatApiRoutes.threadForks(threadId), {
      method: "POST",
      body: input,
      schema: z.strictObject({ thread: threadSchema }),
    })
  }

  editMessage(input: Parameters<ThreadChatApiCapabilities["editMessage"]>[0]) {
    return this.request(threadChatApiRoutes.messageEdits(input.messageId), {
      method: "POST",
      body: {
        parts: input.parts,
        ...(input.requestedModelId
          ? { requestedModelId: input.requestedModelId }
          : {}),
      },
      schema: replacementBundleSchema,
    })
  }

  regenerateMessage(
    input: Parameters<ThreadChatApiCapabilities["regenerateMessage"]>[0]
  ) {
    return this.request(
      threadChatApiRoutes.messageRegenerations(input.messageId),
      {
        method: "POST",
        body: input.requestedModelId
          ? { requestedModelId: input.requestedModelId }
          : {},
        schema: replacementBundleSchema,
      }
    )
  }

  setFeedback(
    messageId: string,
    value: "positive" | "negative" | null
  ) {
    return this.request(threadChatApiRoutes.messageFeedback(messageId), {
      method: "PUT",
      body: { value },
      schema: feedbackSchema,
    })
  }

  loadArtifact(artifactId: string, signal?: AbortSignal) {
    return this.request(threadChatApiRoutes.artifact(artifactId), {
      schema: artifactSchema,
      signal,
    })
  }

  async *subscribeAssistantEvents(
    input: Parameters<ThreadChatApiCapabilities["subscribeAssistantEvents"]>[0]
  ) {
    const query = new URLSearchParams()
    if (input.afterEventSequence !== undefined)
      query.set("afterEventSequence", String(input.afterEventSequence))
    const response = await this.fetcher(
      this.url(
        `${threadChatApiRoutes.assistantEvents(input.assistantMessageId)}${query.size ? `?${query}` : ""}`
      ),
      {
        headers: { Accept: "text/event-stream" },
        credentials: "same-origin",
        signal: input.signal,
      }
    )
    await this.assertSuccess(response)
    if (!response.body) throw new Error("SSE response body is missing.")
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        let boundary = buffer.indexOf("\n\n")
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          if (data) yield assistantMessageEventSchema.parse(JSON.parse(data))
          boundary = buffer.indexOf("\n\n")
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  stopAssistant(assistantMessageId: string) {
    return this.request(threadChatApiRoutes.assistantStop(assistantMessageId), {
      method: "POST",
      schema: assistantRunStateSchema,
    })
  }

  private async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const response = await this.fetcher(this.url(path), {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      signal: options.signal,
    })
    await this.assertSuccess(response)
    const envelope = apiResponseSchema(options.schema).parse(await response.json())
    return envelope.data
  }

  private async requestEmpty(path: string, method: "DELETE"): Promise<void> {
    const response = await this.fetcher(this.url(path), {
      method,
      credentials: "same-origin",
    })
    await this.assertSuccess(response)
  }

  private async assertSuccess(response: Response): Promise<void> {
    if (response.ok) return
    const parsed = apiErrorResponseSchema.safeParse(await response.json())
    if (!parsed.success) throw new Error(`Invalid API error response (${response.status}).`)
    throw new ThreadChatClientError(
      parsed.data.error.code,
      parsed.data.error.message,
      response.status,
      parsed.data.error.details
    )
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }
}
