import type {
  AttachmentKind,
  AttachmentStatus,
} from "@/constants/attachment"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"
import type { ConversationMessageStatus } from "@/lib/thread-chat/domain/conversation"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"

export type MessageFeedback = "up" | "down"
export type ArtifactKind = "markdown" | "code" | "note"

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
  forkContext: string[]
  forkAnchor: TextAnchor | null
  anchorText: string | null
  footnote: number | null
  depth: number
  modelId: string
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

export interface ArtifactDTO {
  id: string
  projectId: string
  threadId: string
  sourceMessageId: string
  sourceThreadTitle: string | null
  sourceThreadFootnote: number | null
  sourceMessageStatus: ConversationMessageStatus
  kind: ArtifactKind
  title: string
  content: string
  language: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ProjectBootstrapDTO {
  project: ProjectDTO | null
  files: ProjectFileDTO[]
  threads: ThreadDTO[]
  messages: MessageDTO[]
  artifacts: ArtifactDTO[]
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
