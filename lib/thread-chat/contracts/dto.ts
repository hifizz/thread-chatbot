import type { DocumentListItemDTO } from "./document"
import type {
  AttachmentKind,
  AttachmentStatus,
} from "@/constants/attachment"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import type { ConversationMessageStatus } from "@/lib/thread-chat/domain/conversation"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

export type MessageFeedback = "up" | "down"
export type ArtifactKind = "markdown" | "code" | "note"

/** Thread 级 GitHub 仓库绑定；null = 未绑定。 */
export interface ThreadRepositoryBinding {
  /** 服务端连接标识；当前固定 "github"。 */
  connectionId: "github"
  /** owner/name 形式的仓库全名。 */
  repositoryFullName: string
  /** 绑定的分支名。 */
  branch: string
}

export interface ProjectDTO {
  id: string
  rootThreadId: string
  autoTitle: string | null
  customTitle: string | null
  target: string | null
  instructions: string | null
  contractVersion: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectListItemDTO {
  id: string
  title: string
  updatedAt: string
  threadCount: number
}

export interface ProjectFileDTO {
  projectId: string
  attachmentId: string
  filename: string
  mimeType: string
  size: number
  kind: AttachmentKind
  status: AttachmentStatus
  pageCount: number | null
  summary: string | null
  suggestedQuestions: string[] | null
  error: string | null
  url: string
  addedAt: string
  createdAt: string
}

export interface ThreadDTO {
  id: string
  projectId: string
  parentId: string | null
  forkMessageId: string | null
  forkArtifactId: string | null
  forkContext: string[]
  forkAnchor: TextAnchor | null
  anchorText: string | null
  footnote: number | null
  depth: number
  modelId: string
  /** GitHub 仓库绑定；null = 未绑定。 */
  repoBinding: ThreadRepositoryBinding | null
  autoTitle: string | null
  customTitle: string | null
  titleGenerationAttempted: boolean
  titleGenerated: boolean
  createdAt: string
  updatedAt: string
}

export interface MessageDTO {
  id: string
  projectId: string
  threadId: string
  sequence: number
  role: "user" | "assistant"
  parts: ThreadChatUIMessage["parts"]
  status: ConversationMessageStatus
  modelId: string | null
  replacesMessageId: string | null
  supersededAt: string | null
  feedback: MessageFeedback | null
  error: { code: string; message: string } | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export interface ArtifactSummaryDTO {
  document?: { id: string; revisionId: string; revisionNumber: number }
  id: string
  projectId: string
  threadId: string
  sourceMessageId: string
  sourceThreadTitle: string | null
  sourceThreadFootnote: number | null
  sourceMessageStatus: ConversationMessageStatus
  kind: ArtifactKind
  title: string
  language: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** 正文按固定 Artifact ID 单独加载。 */
export interface ArtifactDTO extends ArtifactSummaryDTO {
  content: string
}

export interface ProjectBootstrapDTO {
  documents: DocumentListItemDTO[]
  project: ProjectDTO | null
  files: ProjectFileDTO[]
  threads: ThreadDTO[]
  messages: MessageDTO[]
  artifacts: ArtifactSummaryDTO[]
  activeGenerationIds: string[]
}

export interface GenerationAcceptedDTO {
  project: ProjectDTO
  thread: ThreadDTO
  userMessage?: MessageDTO
  assistantMessage: MessageDTO
  streamUrl: string
}

export interface ThreadTitleDTO {
  project: ProjectDTO
  thread: ThreadDTO
  title: string | null
  generated: boolean
}
