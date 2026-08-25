import type { UIMessage } from "ai"
import type { Artifact } from "../domain/artifact"
import type { Message } from "../domain/message"
import type { MessageRun } from "../domain/message-run"
import type { Project, ProjectTarget } from "../domain/project"
import type { Thread } from "../domain/thread"

export type IdGenerator = () => string

export type ThreadChatApplicationDependencies = {
  generateId: IdGenerator
  now: () => Date
  resolveModelId: (requestedModelId?: string) => string
  wakeRunAfterCommit?: (messageRunId: string) => void | Promise<void>
  onWakeError?: (error: unknown) => void
}

export type ProjectArtifactSummary = {
  changeSequence: number
  total: number
  byKind: Record<string, number>
}

export type ThreadMessageBundle = {
  threadId: string
  messages: Message[]
  assistantRuns: MessageRun[]
  hasOlderMessages: boolean
  oldestReturnedSequence: number | null
  newestReturnedSequence: number | null
}

export type CreationBundle = {
  project: Project
  rootThread: Thread
  artifactSummary: ProjectArtifactSummary
  userMessage: Message
  assistantMessage: Message
  assistantRun: MessageRun
}

export type MessageCreationBundle = Pick<
  CreationBundle,
  "userMessage" | "assistantMessage" | "assistantRun"
>

export type ReplacementBundle = {
  supersededMessageIds: string[]
  createdMessages: Message[]
  assistantRun: MessageRun
}

export type ProjectPatch = {
  customTitle?: string | null
  target?: ProjectTarget | null
  instruction?: string | null
}

export type UserMessageInput = UIMessage["parts"]

export type ProjectBootstrap = {
  project: Project
  threadTopology: Thread[]
  artifactSummary: ProjectArtifactSummary
  initialThread: ThreadMessageBundle
}

export type ProjectSummary = Project & {
  displayTitle: string
  threadCount: number
  messageCount: number
}

export type ArtifactResult = Artifact
