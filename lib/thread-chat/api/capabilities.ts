import type { z } from "zod"
import type {
  artifactSchema,
  assistantMessageEventSchema,
  assistantRunStateSchema,
  creationBundleSchema,
  feedbackSchema,
  forkThreadRequestSchema,
  listProjectsResultSchema,
  messageCreationBundleSchema,
  projectBootstrapSchema,
  projectSchema,
  projectTargetSchema,
  replacementBundleSchema,
  threadMessageBundleSchema,
  threadSchema,
  UserMessageParts,
} from "./contracts"

export interface ThreadChatApiCapabilities {
  listProjects(input?: {
    status?: "active" | "archived" | "all"
    limit?: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<z.infer<typeof listProjectsResultSchema>>
  createProject(input: {
    parts: UserMessageParts
    requestedModelId?: string
    signal?: AbortSignal
  }): Promise<z.infer<typeof creationBundleSchema>>
  bootstrapProject(
    projectId: string,
    signal?: AbortSignal
  ): Promise<z.infer<typeof projectBootstrapSchema>>
  patchProject(input: {
    projectId: string
    customTitle?: string | null
    target?: z.infer<typeof projectTargetSchema> | null
    instruction?: string | null
  }): Promise<z.infer<typeof projectSchema>>
  setProjectArchived(
    projectId: string,
    archived: boolean
  ): Promise<z.infer<typeof projectSchema>>
  deleteProject(projectId: string): Promise<void>
  loadThreadMessages(input: {
    threadId: string
    limit?: number
    beforeSequence?: number
    signal?: AbortSignal
  }): Promise<z.infer<typeof threadMessageBundleSchema>>
  patchThread(
    threadId: string,
    customTitle: string | null
  ): Promise<z.infer<typeof threadSchema>>
  setThreadArchived(
    threadId: string,
    archived: boolean
  ): Promise<z.infer<typeof threadSchema>>
  sendMessage(input: {
    threadId: string
    parts: UserMessageParts
    requestedModelId?: string
  }): Promise<z.infer<typeof messageCreationBundleSchema>>
  forkThread(
    threadId: string,
    input: z.infer<typeof forkThreadRequestSchema>
  ): Promise<{ thread: z.infer<typeof threadSchema> }>
  editMessage(input: {
    messageId: string
    parts: UserMessageParts
    requestedModelId?: string
  }): Promise<z.infer<typeof replacementBundleSchema>>
  regenerateMessage(input: {
    messageId: string
    requestedModelId?: string
  }): Promise<z.infer<typeof replacementBundleSchema>>
  setFeedback(
    messageId: string,
    value: "positive" | "negative" | null
  ): Promise<z.infer<typeof feedbackSchema>>
  loadArtifact(
    artifactId: string,
    signal?: AbortSignal
  ): Promise<z.infer<typeof artifactSchema>>
  subscribeAssistantEvents(input: {
    assistantMessageId: string
    afterEventSequence?: number
    signal?: AbortSignal
  }): AsyncIterable<z.infer<typeof assistantMessageEventSchema>>
  stopAssistant(
    assistantMessageId: string
  ): Promise<z.infer<typeof assistantRunStateSchema>>
}
