import type { StoreApi } from "zustand/vanilla"
import type { ThreadChatApiCapabilities } from "../api/capabilities"
import { ThreadChatClientError } from "../api/client-error"
import {
  assistantRunStateSchema,
  creationBundleSchema,
  feedbackSchema,
  listProjectsResultSchema,
  messageCreationBundleSchema,
  projectBootstrapSchema,
  projectSchema,
  replacementBundleSchema,
  threadSchema,
} from "../api/contracts"
import { threadChatRoutes } from "../api/routes"
import { clientInvariant, isAbortError, normalizeClientError } from "./errors"
import { selectForkAvailability } from "./selectors"
import type {
  GenerationCoordinator,
  NavigationCapability,
  NewProjectDraftStore,
  ProjectRuntimeRegistry,
  ThreadChatAppCommands,
  ThreadChatAppStore,
  ThreadChatProjectCommands,
  ThreadChatProjectStore,
  ThreadMessageLoader,
  ArtifactLoader,
} from "./types"

async function runProjectCommand(input: {
  store: StoreApi<ThreadChatProjectStore>
  scope: string
  execute(): Promise<void>
}): Promise<void> {
  if (
    input.store.getState().requests.commandByScope[input.scope]?.status ===
    "submitting"
  )
    return
  input.store.getState().setCommandState(input.scope, { status: "submitting" })
  try {
    await input.execute()
    input.store.getState().setCommandState(input.scope, null)
  } catch (error) {
    input.store.getState().setCommandState(input.scope, {
      status: "error",
      error: normalizeClientError(error),
    })
  }
}

export function createThreadChatProjectCommands(input: {
  projectId: string
  api: ThreadChatApiCapabilities
  store: StoreApi<ThreadChatProjectStore>
  messageLoader: ThreadMessageLoader
  artifactLoader: ArtifactLoader
  generationCoordinator: GenerationCoordinator
}): { commands: ThreadChatProjectCommands; destroy(): void } {
  let bootstrapPromise: Promise<void> | null = null
  let bootstrapController: AbortController | null = null
  let disposed = false

  const commands: ThreadChatProjectCommands = {
    loadProjectBootstrap() {
      const state = input.store.getState()
      if (state.requests.bootstrap.status === "ready") {
        input.generationCoordinator.resumeLoadedRuns()
        return Promise.resolve()
      }
      if (bootstrapPromise) return bootstrapPromise
      state.setBootstrapLoadState({ status: "loading" })
      bootstrapController = new AbortController()
      bootstrapPromise = input.api
        .bootstrapProject(input.projectId, bootstrapController.signal)
        .then((rawBootstrap) => {
          if (disposed) return
          const bootstrap = projectBootstrapSchema.parse(rawBootstrap)
          input.store.getState().mergeBootstrap(bootstrap)
          input.generationCoordinator.resumeLoadedRuns()
        })
        .catch((error: unknown) => {
          if (disposed || isAbortError(error)) return
          input.store.getState().setBootstrapLoadState({
            status: "error",
            error: normalizeClientError(error),
          })
        })
        .finally(() => {
          bootstrapPromise = null
          bootstrapController = null
        })
      return bootstrapPromise
    },
    ensureThreadMessages: input.messageLoader.ensure,
    ensureArtifact: input.artifactLoader.ensure,
    updateProject(patch) {
      return runProjectCommand({
        store: input.store,
        scope: `project:update:${input.projectId}`,
        execute: async () => {
          input.store.getState().applyProject(
            projectSchema.parse(
              await input.api.patchProject({
                projectId: input.projectId,
                ...patch,
              })
            )
          )
        },
      })
    },
    updateThread(threadId, customTitle) {
      return runProjectCommand({
        store: input.store,
        scope: `thread:update:${threadId}`,
        execute: async () => {
          input.store
            .getState()
            .applyThread(
              threadSchema.parse(
                await input.api.patchThread(threadId, customTitle)
              )
            )
        },
      })
    },
    setProjectArchived(archived) {
      return runProjectCommand({
        store: input.store,
        scope: `project:archive:${input.projectId}`,
        execute: async () => {
          input.store
            .getState()
            .applyProject(
              projectSchema.parse(
                await input.api.setProjectArchived(input.projectId, archived)
              )
            )
        },
      })
    },
    setThreadArchived(threadId, archived) {
      return runProjectCommand({
        store: input.store,
        scope: `thread:archive:${threadId}`,
        execute: async () => {
          input.store
            .getState()
            .applyThread(
              threadSchema.parse(
                await input.api.setThreadArchived(threadId, archived)
              )
            )
        },
      })
    },
    deleteProject() {
      return runProjectCommand({
        store: input.store,
        scope: `project:delete:${input.projectId}`,
        execute: () => input.api.deleteProject(input.projectId),
      })
    },
    sendMessage(threadId, parts, requestedModelId) {
      return runProjectCommand({
        store: input.store,
        scope: `send:${threadId}`,
        execute: async () => {
          const bundle = messageCreationBundleSchema.parse(
            await input.api.sendMessage({
              threadId,
              parts,
              requestedModelId,
            })
          )
          input.store.getState().applyMessageCreationBundle(bundle)
          input.generationCoordinator.subscribeAssistant(
            bundle.assistantRun.assistantMessageId
          )
        },
      })
    },
    forkThread(command) {
      return runProjectCommand({
        store: input.store,
        scope: `fork:${command.sourceMessageId}`,
        execute: async () => {
          const availability = selectForkAvailability(
            input.store.getState(),
            command.sourceMessageId
          )
          if (!availability.allowed) clientInvariant(false, availability.reason)
          const rawResult = await input.api.forkThread(command.sourceThreadId, {
            sourceMessageId: command.sourceMessageId,
            anchor: command.anchor,
          })
          const result = { thread: threadSchema.parse(rawResult.thread) }
          input.store.getState().applyThreadCreated(result.thread)
          input.store
            .getState()
            .openThread(result.thread.id, command.sourceSlotId)
        },
      })
    },
    editMessage(messageId, parts, requestedModelId) {
      return runProjectCommand({
        store: input.store,
        scope: `edit:${messageId}`,
        execute: async () => {
          const bundle = replacementBundleSchema.parse(
            await input.api.editMessage({
              messageId,
              parts,
              requestedModelId,
            })
          )
          input.store.getState().applyReplacementBundle(bundle)
          input.generationCoordinator.subscribeAssistant(
            bundle.assistantRun.assistantMessageId
          )
        },
      })
    },
    regenerateMessage(messageId, requestedModelId) {
      return runProjectCommand({
        store: input.store,
        scope: `regenerate:${messageId}`,
        execute: async () => {
          const bundle = replacementBundleSchema.parse(
            await input.api.regenerateMessage({
              messageId,
              requestedModelId,
            })
          )
          input.store.getState().applyReplacementBundle(bundle)
          input.generationCoordinator.subscribeAssistant(
            bundle.assistantRun.assistantMessageId
          )
        },
      })
    },
    setFeedback(messageId, value) {
      return runProjectCommand({
        store: input.store,
        scope: `feedback:${messageId}`,
        execute: async () => {
          input.store
            .getState()
            .applyFeedback(
              feedbackSchema.parse(
                await input.api.setFeedback(messageId, value)
              )
            )
        },
      })
    },
    stopAssistant(assistantMessageId) {
      return runProjectCommand({
        store: input.store,
        scope: `stop:${assistantMessageId}`,
        execute: async () => {
          input.store
            .getState()
            .applyAssistantRun(
              assistantRunStateSchema.parse(
                await input.api.stopAssistant(assistantMessageId)
              )
            )
        },
      })
    },
  }

  return {
    commands,
    destroy() {
      disposed = true
      bootstrapController?.abort()
      bootstrapController = null
      bootstrapPromise = null
    },
  }
}

export function createThreadChatAppCommands(input: {
  api: ThreadChatApiCapabilities
  store: StoreApi<ThreadChatAppStore>
  navigation: NavigationCapability
}): { commands: ThreadChatAppCommands; destroy(): void } {
  let catalogPromise: Promise<void> | null = null
  let controller: AbortController | null = null
  let disposed = false

  return {
    commands: {
      loadProjectCatalog({ reset = false } = {}) {
        if (catalogPromise) return catalogPromise
        const state = input.store.getState()
        if (
          !reset &&
          state.catalog.loadState.status === "ready" &&
          !state.catalog.nextCursor
        )
          return Promise.resolve()
        state.setCatalogLoadState({ status: "loading" })
        controller = new AbortController()
        catalogPromise = input.api
          .listProjects({
            status: state.catalog.activeFilter,
            cursor: reset ? undefined : (state.catalog.nextCursor ?? undefined),
            signal: controller.signal,
          })
          .then((rawResult) => {
            if (!disposed)
              input.store
                .getState()
                .mergeProjectPage(
                  listProjectsResultSchema.parse(rawResult),
                  reset
                )
          })
          .catch((error: unknown) => {
            if (disposed || isAbortError(error)) return
            input.store.getState().setCatalogLoadState({
              status: "error",
              error: normalizeClientError(error),
            })
          })
          .finally(() => {
            catalogPromise = null
            controller = null
          })
        return catalogPromise
      },
      async setProjectArchived(projectId, archived) {
        const project = projectSchema.parse(
          await input.api.setProjectArchived(projectId, archived)
        )
        const current = input.store.getState().catalog.projectsById[projectId]
        if (!current) return
        input.store.getState().upsertProjectSummary({
          ...current,
          displayTitle: project.customTitle ?? project.autoTitle ?? "",
          archivedAt: project.archivedAt,
          updatedAt: project.updatedAt,
        })
      },
      async deleteProject(projectId) {
        await input.api.deleteProject(projectId)
        input.store.getState().removeProjectSummary(projectId)
        if (input.navigation.currentProjectId?.() === projectId)
          input.navigation.replace(threadChatRoutes.newProject())
      },
    },
    destroy() {
      disposed = true
      controller?.abort()
      controller = null
      catalogPromise = null
    },
  }
}

export async function submitNewProjectDraft(input: {
  api: ThreadChatApiCapabilities
  appStore: StoreApi<ThreadChatAppStore>
  registry: ProjectRuntimeRegistry
  navigation: NavigationCapability
  draftStore: StoreApi<NewProjectDraftStore>
}): Promise<void> {
  const draft = input.draftStore.getState()
  if (draft.status === "submitting") return
  const parts = structuredClone(draft.draftParts)
  draft.markSubmitting()
  try {
    const bundle = creationBundleSchema.parse(
      await input.api.createProject({
        parts,
        requestedModelId: draft.requestedModelId,
      })
    )
    const runtime = input.registry.seedFromCreation(bundle)
    input.appStore.getState().upsertProjectSummary({
      id: bundle.project.id,
      displayTitle:
        bundle.project.customTitle ?? bundle.project.autoTitle ?? "New project",
      archivedAt: bundle.project.archivedAt,
      updatedAt: bundle.project.updatedAt,
      threadCount: 1,
      messageCount: 2,
    })
    input.appStore.getState().setProjectRoutePending(bundle.project.id)
    runtime.generationCoordinator.subscribeAssistant(
      bundle.assistantRun.assistantMessageId
    )
    input.navigation.replace(threadChatRoutes.project(bundle.project.id))
  } catch (error) {
    const normalized = normalizeClientError(error)
    input.draftStore
      .getState()
      .markError(
        normalized.status === 0
          ? new ThreadChatClientError(
              normalized.code,
              "Project creation result is unknown. Check the project list before retrying.",
              normalized.status,
              normalized.details
            )
          : normalized
      )
  }
}
