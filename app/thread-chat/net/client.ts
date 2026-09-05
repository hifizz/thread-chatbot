import type {
  AddProjectFileCommand,
  DeleteProjectCommand,
  EditLatestTurnCommand,
  ForkThreadCommand,
  RemoveProjectFileCommand,
  RenameProjectCommand,
  RetryMessageCommand,
  SendMessageCommand,
  SetFeedbackCommand,
  SetProjectArchivedCommand,
  StartProjectCommand,
  StopMessageCommand,
  UpdateProjectContractCommand,
  UpdateThreadCommand,
} from "@/lib/thread-chat/contracts/commands"
import type {
  ArtifactDTO,
  GenerationAcceptedDTO,
  MessageDTO,
  ProjectBootstrapDTO,
  ProjectDTO,
  ProjectListItemDTO,
  ProjectFileDTO,
  ThreadTitleDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type {
  ApiErrorDTO,
  CommandResponse,
} from "@/lib/thread-chat/contracts/errors"

export class ThreadChatApiError extends Error {
  readonly status: number
  readonly detail: ApiErrorDTO

  constructor(status: number, detail: ApiErrorDTO) {
    super(detail.message)
    this.name = "ThreadChatApiError"
    this.status = status
    this.detail = detail
  }
}

export interface ThreadChatClientOptions {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export interface ForkAcceptedDTO {
  thread: ThreadDTO
  generation: GenerationAcceptedDTO | null
}

export interface EditAcceptedDTO {
  generation: GenerationAcceptedDTO
  abortMessageId: string | null
}

export interface DeleteAcceptedDTO {
  projectId: string
  deleted: true
}

export interface RemoveProjectFileAcceptedDTO {
  projectId: string
  attachmentId: string
  removed: true
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`
}

async function decodeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ThreadChatApiError(response.status, {
      code: "GENERATION_FAILED",
      message: "服务器返回了无法解析的响应",
    })
  }
}

async function requestJson<T>(
  fetcher: typeof globalThis.fetch,
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetcher(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const body = await decodeJson(response)
  if (!response.ok) {
    const error = (body as { error?: ApiErrorDTO }).error
    throw new ThreadChatApiError(
      response.status,
      error ?? {
        code: "GENERATION_FAILED",
        message: "请求失败，请稍后重试",
      }
    )
  }
  return body as T
}

async function command<T>(
  fetcher: typeof globalThis.fetch,
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body: object
): Promise<Extract<CommandResponse<T>, { ok: true }>> {
  const response = await requestJson<CommandResponse<T>>(fetcher, url, {
    method,
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new ThreadChatApiError(409, response.error)
  return response
}

export function createThreadChatClient(options: ThreadChatClientOptions = {}) {
  const baseUrl = options.baseUrl ?? ""
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const url = (path: string) => apiUrl(baseUrl, path)

  return {
    listProjects(archived = false) {
      return requestJson<ProjectListItemDTO[]>(
        fetcher,
        url(`/api/thread-chat/v1/projects?archived=${String(archived)}`)
      )
    },
    getProject(projectId: string) {
      return requestJson<ProjectBootstrapDTO>(
        fetcher,
        url(`/api/thread-chat/v1/projects/${projectId}`)
      )
    },
    getMessage(messageId: string) {
      return requestJson<MessageDTO>(
        fetcher,
        url(`/api/thread-chat/v1/messages/${messageId}`)
      )
    },
    getArtifact(artifactId: string) {
      return requestJson<ArtifactDTO>(
        fetcher,
        url(`/api/thread-chat/v1/artifacts/${artifactId}`)
      )
    },
    startProject(projectId: string, input: StartProjectCommand) {
      return command<GenerationAcceptedDTO>(
        fetcher,
        url(`/api/thread-chat/v1/projects/${projectId}/start`),
        "POST",
        input
      )
    },
    sendMessage(threadId: string, input: SendMessageCommand) {
      return command<GenerationAcceptedDTO>(
        fetcher,
        url(`/api/thread-chat/v1/threads/${threadId}/messages`),
        "POST",
        input
      )
    },
    generateThreadTitle(threadId: string) {
      return requestJson<ThreadTitleDTO>(
        fetcher,
        url(`/api/thread-chat/v1/threads/${threadId}/title`),
        { method: "POST" }
      )
    },
    forkThread(threadId: string, input: ForkThreadCommand) {
      return command<ForkAcceptedDTO>(
        fetcher,
        url(`/api/thread-chat/v1/threads/${threadId}/forks`),
        "POST",
        input
      )
    },
    editMessage(messageId: string, input: EditLatestTurnCommand) {
      return command<EditAcceptedDTO>(
        fetcher,
        url(`/api/thread-chat/v1/messages/${messageId}/edit`),
        "POST",
        input
      )
    },
    retryMessage(messageId: string, input: RetryMessageCommand) {
      return command<GenerationAcceptedDTO>(
        fetcher,
        url(`/api/thread-chat/v1/messages/${messageId}/retry`),
        "POST",
        input
      )
    },
    stopMessage(messageId: string, input: StopMessageCommand) {
      return command<MessageDTO>(
        fetcher,
        url(`/api/thread-chat/v1/messages/${messageId}/stop`),
        "POST",
        input
      )
    },
    setFeedback(messageId: string, input: SetFeedbackCommand) {
      return command<MessageDTO>(
        fetcher,
        url(`/api/thread-chat/v1/messages/${messageId}/feedback`),
        "PUT",
        input
      )
    },
    updateThread(threadId: string, input: UpdateThreadCommand) {
      return command<ThreadDTO>(
        fetcher,
        url(`/api/thread-chat/v1/threads/${threadId}`),
        "PATCH",
        input
      )
    },
    renameProject(projectId: string, input: RenameProjectCommand) {
      return command<ProjectDTO>(
        fetcher,
        url(`/api/thread-chat/v1/projects/${projectId}`),
        "PATCH",
        input
      )
    },
    updateProjectContract(
      projectId: string,
      input: UpdateProjectContractCommand
    ) {
      return command<ProjectDTO>(
        fetcher,
        url(`/api/thread-chat/v1/projects/${projectId}`),
        "PATCH",
        input
      )
    },
    addProjectFile(projectId: string, input: AddProjectFileCommand) {
      return command<ProjectFileDTO>(
        fetcher,
        url(`/api/thread-chat/v1/projects/${projectId}/files`),
        "POST",
        input
      )
    },
    removeProjectFile(
      projectId: string,
      attachmentId: string,
      input: RemoveProjectFileCommand
    ) {
      return command<RemoveProjectFileAcceptedDTO>(
        fetcher,
        url(
          `/api/thread-chat/v1/projects/${projectId}/files/${attachmentId}`
        ),
        "DELETE",
        input
      )
    },
    setProjectArchived(projectId: string, input: SetProjectArchivedCommand) {
      return command<ProjectDTO>(
        fetcher,
        url(`/api/thread-chat/v1/projects/${projectId}`),
        "PATCH",
        input
      )
    },
    deleteProject(projectId: string, input: DeleteProjectCommand) {
      return command<DeleteAcceptedDTO>(
        fetcher,
        url(`/api/thread-chat/v1/projects/${projectId}`),
        "DELETE",
        input
      )
    },
  }
}

export type ThreadChatClient = ReturnType<typeof createThreadChatClient>
