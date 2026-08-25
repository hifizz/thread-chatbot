import type { z } from "zod"
import type { StoreApi } from "zustand/vanilla"
import type { ThreadChatClientError } from "../api/client-error"
import type { ThreadChatApiCapabilities } from "../api/capabilities"
import type {
  artifactSchema,
  assistantMessageEventSchema,
  assistantRunStateSchema,
  creationBundleSchema,
  feedbackSchema,
  listProjectsResultSchema,
  messageCreationBundleSchema,
  messageSchema,
  projectBootstrapSchema,
  projectSchema,
  projectSummarySchema,
  replacementBundleSchema,
  threadMessageBundleSchema,
  threadSchema,
  UserMessageParts,
} from "../api/contracts"

export type ProjectEntity = z.infer<typeof projectSchema>
export type ProjectSummary = z.infer<typeof projectSummarySchema>
export type ThreadEntity = z.infer<typeof threadSchema>
export type MessageEntity = z.infer<typeof messageSchema>
export type AssistantRunState = z.infer<typeof assistantRunStateSchema>
export type ArtifactEntity = z.infer<typeof artifactSchema>
export type Feedback = z.infer<typeof feedbackSchema>
export type ListProjectsResult = z.infer<typeof listProjectsResultSchema>
export type CreationBundle = z.infer<typeof creationBundleSchema>
export type ProjectBootstrap = z.infer<typeof projectBootstrapSchema>
export type ThreadMessageBundle = z.infer<typeof threadMessageBundleSchema>
export type MessageCreationBundle = z.infer<typeof messageCreationBundleSchema>
export type ReplacementBundle = z.infer<typeof replacementBundleSchema>
export type AssistantMessageEvent = z.infer<typeof assistantMessageEventSchema>

export type ProjectId = string
export type ThreadId = string
export type MessageId = string
export type ArtifactId = string
export type ColumnSlotId = string

export type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; error: ThreadChatClientError }

export type CommandState =
  { status: "submitting" } | { status: "error"; error: ThreadChatClientError }

export interface ThreadMessageWindowState {
  loadState: LoadState
  hasOlderMessages: boolean
  oldestReturnedSequence: number | null
  newestReturnedSequence: number | null
}

export interface ProjectCatalogState {
  projectsById: Record<ProjectId, ProjectSummary>
  orderedProjectIds: ProjectId[]
  loadState: LoadState
  activeFilter: "active" | "archived"
  nextCursor: string | null
}

export interface AppShellUiState {
  sidebarOpen: boolean
  sidebarWidth: number
  projectSearchQuery: string
  pendingProjectId: ProjectId | null
}

export interface ThreadChatAppState {
  catalog: ProjectCatalogState
  shellUi: AppShellUiState
}

export interface ThreadChatAppActions {
  mergeProjectPage(result: ListProjectsResult, reset?: boolean): void
  upsertProjectSummary(summary: ProjectSummary): void
  removeProjectSummary(projectId: ProjectId): void
  setCatalogLoadState(state: LoadState): void
  setCatalogFilter(filter: ProjectCatalogState["activeFilter"]): void
  setProjectRoutePending(projectId: ProjectId | null): void
  setSidebarOpen(open: boolean): void
  setSidebarWidth(width: number): void
  setProjectSearchQuery(query: string): void
}

export type ThreadChatAppStore = ThreadChatAppState & ThreadChatAppActions

export interface ThreadChatEntitiesState {
  project: ProjectEntity | null
  threadsById: Record<ThreadId, ThreadEntity>
  messagesById: Record<MessageId, MessageEntity>
  messageIdsByThreadId: Record<ThreadId, MessageId[]>
  artifactsById: Record<ArtifactId, ArtifactEntity>
  feedbackByMessageId: Record<MessageId, Feedback>
}

export interface StreamBuffer {
  pendingChunks: Extract<
    AssistantMessageEvent,
    { type: "run.delta" }
  >["chunk"][]
  lastReceivedEventSequence: number
  flushScheduled: boolean
}

export interface ThreadChatRunsState {
  byAssistantMessageId: Record<MessageId, AssistantRunState>
  streamBuffersByAssistantMessageId: Record<MessageId, StreamBuffer>
}

export interface ThreadChatRequestsState {
  bootstrap: LoadState
  threadMessagesById: Record<ThreadId, ThreadMessageWindowState>
  artifactById: Record<ArtifactId, LoadState>
  commandByScope: Record<string, CommandState>
}

export interface ProjectArtifactSummary {
  changeSequence: number
  total: number
  byKind: Record<string, number>
}

export interface ThreadColumnSlot {
  slotId: ColumnSlotId
  threadId: ThreadId
  folded: boolean
  widthPx: number | null
}

export interface Point {
  x: number
  y: number
}

export interface TextSelectionState {
  messageId: MessageId
  exactQuote: string
  textPosition?: { start: number; end: number }
}

export interface OverlayState {
  selection: TextSelectionState | null
  threadSwitcherScope:
    | { kind: "global" }
    | { kind: "column"; slotId: ColumnSlotId }
    | { kind: "subtree"; rootThreadId: ThreadId }
    | null
  treeListOpen: boolean
  helpPanelOpen: boolean
  artifactDrawerOpen: boolean
}

export interface ThreadChatUiState {
  columnSlots: ThreadColumnSlot[]
  focusedSlotId: "root" | ColumnSlotId | null
  rootColumnWidthPx: number | null
  forceColumnCount: number | null
  placementMode: "replace" | "fold"
  viewMode: "columns" | "canvas"
  canvasPins: Record<ThreadId, Point>
  composerDraftByThreadId: Record<ThreadId, UserMessageParts>
  selectedArtifactId: ArtifactId | null
  activationClock: number
  lastActivatedOrderBySlotId: Record<string, number>
  overlays: OverlayState
}

export interface ThreadChatProjectState {
  entities: ThreadChatEntitiesState
  runs: ThreadChatRunsState
  requests: ThreadChatRequestsState
  readModels: {
    artifactSummary: ProjectArtifactSummary | null
    replacementSupersededMessageIds: Record<MessageId, true>
  }
  ui: ThreadChatUiState
}

export interface ThreadWorkbenchSnapshotV1 {
  schemaVersion: 1
  columnSlots: ThreadColumnSlot[]
  focusedSlotId: "root" | ColumnSlotId
  rootColumnWidthPx: number | null
  forceColumnCount: number | null
  placementMode: "replace" | "fold"
  viewMode: "columns" | "canvas"
  canvasPins: Record<ThreadId, Point>
}

export interface ThreadPlacementOptions {
  maxExpanded?: number
  keepSource?: boolean
  targetSlotId?: ColumnSlotId
}

export interface ThreadChatProjectActions {
  mergeCreationBundle(bundle: CreationBundle): void
  mergeBootstrap(bootstrap: ProjectBootstrap): void
  applyMessageBundle(bundle: ThreadMessageBundle): void
  applyMessageCreationBundle(bundle: MessageCreationBundle): void
  applyThreadCreated(thread: ThreadEntity): void
  applyReplacementBundle(bundle: ReplacementBundle): void
  applyRunEvent(
    event: AssistantMessageEvent,
    assistantMessageId?: MessageId
  ): void
  applyAssistantRun(run: AssistantRunState): void
  flushRunBuffer(assistantMessageId: MessageId): void
  applyArtifact(artifact: ArtifactEntity): void
  applyProject(project: ProjectEntity): void
  applyThread(thread: ThreadEntity): void
  applyFeedback(feedback: Feedback): void
  setBootstrapLoadState(state: LoadState): void
  setCommandState(scope: string, state: CommandState | null): void
  setThreadMessageLoadState(threadId: ThreadId, state: LoadState): void
  setArtifactLoadState(artifactId: ArtifactId, state: LoadState): void
  restoreWorkbenchSnapshot(snapshot: ThreadWorkbenchSnapshotV1): void
  resetWorkbenchToDefault(): void
  openThread(
    threadId: ThreadId,
    sourceSlotId: "root" | ColumnSlotId,
    placement?: ThreadPlacementOptions
  ): void
  switchColumnThread(slotId: ColumnSlotId, threadId: ThreadId): void
  closeColumn(slotId: ColumnSlotId): void
  setColumnFolded(slotId: ColumnSlotId, folded: boolean): void
  focusColumn(slotId: "root" | ColumnSlotId): void
  commitColumnWidths(
    widths: Partial<Record<"root" | ColumnSlotId, number | null>>
  ): void
  setForceColumnCount(count: number | null): void
  setPlacementMode(mode: ThreadChatUiState["placementMode"]): void
  setViewMode(mode: ThreadChatUiState["viewMode"]): void
  setCanvasPin(threadId: ThreadId, point: Point | null): void
  setComposerDraft(threadId: ThreadId, parts: UserMessageParts): void
  setSelectedArtifact(artifactId: ArtifactId | null): void
  setOverlays(patch: Partial<OverlayState>): void
}

export type ThreadChatProjectStore = ThreadChatProjectState &
  ThreadChatProjectActions

export interface GenerationCoordinator {
  resumeLoadedRuns(): void
  subscribeAssistant(assistantMessageId: MessageId): void
  unsubscribeAssistant(assistantMessageId: MessageId): void
  destroy(): void
}

export interface ThreadMessageLoader {
  ensure(threadId: ThreadId): Promise<void>
  destroy(): void
}

export interface ArtifactLoader {
  ensure(artifactId: ArtifactId): Promise<void>
  destroy(): void
}

export interface ThreadChatProjectCommands {
  loadProjectBootstrap(): Promise<void>
  ensureThreadMessages(threadId: ThreadId): Promise<void>
  ensureArtifact(artifactId: ArtifactId): Promise<void>
  updateProject(
    patch: Omit<
      Parameters<ThreadChatApiCapabilities["patchProject"]>[0],
      "projectId"
    >
  ): Promise<void>
  updateThread(threadId: ThreadId, customTitle: string | null): Promise<void>
  setProjectArchived(archived: boolean): Promise<void>
  setThreadArchived(threadId: ThreadId, archived: boolean): Promise<void>
  deleteProject(): Promise<void>
  sendMessage(
    threadId: ThreadId,
    parts: UserMessageParts,
    requestedModelId?: string
  ): Promise<void>
  forkThread(input: {
    sourceSlotId: "root" | ColumnSlotId
    placement?: ThreadPlacementOptions
    sourceThreadId: ThreadId
    sourceMessageId: MessageId
    anchor?: {
      exactQuote: string
      textPosition?: { start: number; end: number }
    }
  }): Promise<void>
  editMessage(
    messageId: MessageId,
    parts: UserMessageParts,
    requestedModelId?: string
  ): Promise<void>
  regenerateMessage(
    messageId: MessageId,
    requestedModelId?: string
  ): Promise<void>
  setFeedback(
    messageId: MessageId,
    value: "positive" | "negative" | null
  ): Promise<void>
  stopAssistant(assistantMessageId: MessageId): Promise<void>
}

export interface ThreadChatProjectRuntime {
  projectId: ProjectId
  store: StoreApi<ThreadChatProjectStore>
  commands: ThreadChatProjectCommands
  messageLoader: ThreadMessageLoader
  artifactLoader: ArtifactLoader
  generationCoordinator: GenerationCoordinator
  destroy(): void
}

export interface ProjectRuntimeRegistry {
  seedFromCreation(bundle: CreationBundle): ThreadChatProjectRuntime
  acquire(projectId: ProjectId): ThreadChatProjectRuntime
  release(projectId: ProjectId): void
  peek(projectId: ProjectId): ThreadChatProjectRuntime | null
  destroy(): void
}

export interface ThreadChatAppCommands {
  loadProjectCatalog(input?: { reset?: boolean }): Promise<void>
  setProjectArchived(projectId: ProjectId, archived: boolean): Promise<void>
  deleteProject(projectId: ProjectId): Promise<void>
}

export interface NavigationCapability {
  replace(path: string): void
  currentProjectId?(): ProjectId | null
}

export interface ThreadChatAppRuntime {
  appStore: StoreApi<ThreadChatAppStore>
  projectRuntimeRegistry: ProjectRuntimeRegistry
  api: ThreadChatApiCapabilities
  commands: ThreadChatAppCommands
  navigation: NavigationCapability
  destroy(): void
}

export interface NewProjectDraftState {
  draftParts: UserMessageParts
  requestedModelId?: string
  status: "idle" | "submitting" | "error"
  error: ThreadChatClientError | null
}

export interface NewProjectDraftActions {
  setDraftParts(parts: UserMessageParts): void
  setRequestedModelId(modelId?: string): void
  markSubmitting(): void
  markError(error: ThreadChatClientError): void
  markIdle(): void
}

export type NewProjectDraftStore = NewProjectDraftState & NewProjectDraftActions
