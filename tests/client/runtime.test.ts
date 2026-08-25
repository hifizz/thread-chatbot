import { describe, expect, it, vi } from "vitest"
import { createThreadChatProjectCommands } from "@/lib/thread-chat/client/commands"
import { createGenerationCoordinator } from "@/lib/thread-chat/client/generation-coordinator"
import {
  createArtifactLoader,
  createThreadMessageLoader,
} from "@/lib/thread-chat/client/loaders"
import { createThreadChatProjectStore } from "@/lib/thread-chat/client/project-store"
import {
  createProjectRuntimeRegistry,
  createThreadChatProjectRuntime,
} from "@/lib/thread-chat/client/runtime"
import type {
  AssistantMessageEvent,
  GenerationCoordinator,
} from "@/lib/thread-chat/client/types"
import {
  assistantMessageDTOFixture,
  assistantRunDTOFixture,
  creationBundleDTOFixture,
  projectDTOFixture,
  rootThreadDTOFixture,
  userMessageDTOFixture,
} from "../fixtures/thread-chat-api-fixtures"
import { createTestApi } from "./test-api"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const branch = {
  ...rootThreadDTOFixture,
  id: "00000000-0000-4000-8000-000000000301",
  parentThreadId: rootThreadDTOFixture.id,
  sourceMessageId: userMessageDTOFixture.id,
  forkSourceSnapshot: {
    schemaVersion: 1 as const,
    sourceRole: "user" as const,
    sourceSequence: 1,
  },
}

describe("ThreadChat client runtime", () => {
  it("Project 冷启动先落 Bootstrap，再恢复 Workbench，且 Branch 失败彼此隔离", async () => {
    const secondBranch = {
      ...branch,
      id: "00000000-0000-4000-8000-000000000302",
    }
    const branchUser = {
      ...userMessageDTOFixture,
      id: "00000000-0000-4000-8000-000000000307",
      threadId: branch.id,
      sequence: 1,
    }
    const branchAssistant = {
      ...assistantMessageDTOFixture,
      id: "00000000-0000-4000-8000-000000000308",
      threadId: branch.id,
      sequence: 2,
    }
    const loadThreadMessages = vi.fn(
      async ({ threadId }: { threadId: string }) => {
        if (threadId === secondBranch.id) throw new Error("branch unavailable")
        return {
          threadId,
          messages: [branchUser, branchAssistant],
          assistantRuns: [
            {
              ...assistantRunDTOFixture,
              assistantMessageId: branchAssistant.id,
            },
          ],
          hasOlderMessages: false,
          oldestReturnedSequence: 1,
          newestReturnedSequence: 2,
        }
      }
    )
    const runtime = createThreadChatProjectRuntime({
      projectId: projectDTOFixture.id,
      api: createTestApi({
        bootstrapProject: vi.fn().mockResolvedValue({
          project: projectDTOFixture,
          threadTopology: [rootThreadDTOFixture, branch, secondBranch],
          artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
          initialThread: {
            threadId: rootThreadDTOFixture.id,
            messages: [userMessageDTOFixture, assistantMessageDTOFixture],
            assistantRuns: [assistantRunDTOFixture],
            hasOlderMessages: false,
            oldestReturnedSequence: 1,
            newestReturnedSequence: 2,
          },
        }),
        loadThreadMessages,
      }),
      generateSlotId: () => "slot-branch",
    })

    await runtime.commands.loadProjectBootstrap()
    expect(runtime.store.getState().ui).toMatchObject({
      columnSlots: [],
      focusedSlotId: "root",
      viewMode: "columns",
    })
    runtime.store.getState().restoreWorkbenchSnapshot({
      schemaVersion: 1,
      columnSlots: [
        {
          slotId: "saved-branch",
          threadId: branch.id,
          folded: false,
          widthPx: 420,
        },
      ],
      focusedSlotId: "saved-branch",
      rootColumnWidthPx: 560,
      forceColumnCount: 3,
      placementMode: "replace",
      viewMode: "columns",
      canvasPins: {},
    })
    expect(runtime.store.getState().ui).toMatchObject({
      columnSlots: [
        {
          slotId: "saved-branch",
          threadId: branch.id,
          folded: false,
          widthPx: 420,
        },
      ],
      focusedSlotId: "saved-branch",
      rootColumnWidthPx: 560,
      forceColumnCount: 3,
    })

    await Promise.all([
      runtime.commands.ensureThreadMessages(branch.id),
      runtime.commands.ensureThreadMessages(secondBranch.id),
    ])
    expect(
      runtime.store.getState().requests.threadMessagesById[branch.id]
        .loadState.status
    ).toBe("ready")
    expect(
      runtime.store.getState().requests.threadMessagesById[secondBranch.id]
        .loadState.status
    ).toBe("error")
    expect(
      runtime.store.getState().requests.threadMessagesById[
        rootThreadDTOFixture.id
      ].loadState.status
    ).toBe("ready")
    runtime.destroy()
  })

  it("刷新冷启动复用 running Run，并从同一 assistantMessageId 恢复到终态", async () => {
    const runningRun = {
      ...assistantRunDTOFixture,
      status: "running" as const,
      finishedAt: null,
    }
    const subscribeAssistantEvents = vi.fn(async function* () {
      yield {
        type: "run.completed" as const,
        eventSequence: 1,
        run: {
          ...assistantRunDTOFixture,
          status: "completed" as const,
          eventSequence: 1,
          finishedAt: "2026-08-25T00:01:00.000Z",
        },
        message: {
          ...assistantMessageDTOFixture,
          parts: [{ type: "text" as const, text: "recovered" }],
          finalizedAt: "2026-08-25T00:01:00.000Z",
        },
        artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
      }
    })
    const runtime = createThreadChatProjectRuntime({
      projectId: projectDTOFixture.id,
      api: createTestApi({
        bootstrapProject: vi.fn().mockResolvedValue({
          project: projectDTOFixture,
          threadTopology: [rootThreadDTOFixture],
          artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
          initialThread: {
            threadId: rootThreadDTOFixture.id,
            messages: [userMessageDTOFixture, assistantMessageDTOFixture],
            assistantRuns: [runningRun],
            hasOlderMessages: false,
            oldestReturnedSequence: 1,
            newestReturnedSequence: 2,
          },
        }),
        subscribeAssistantEvents,
      }),
    })

    await runtime.commands.loadProjectBootstrap()
    await vi.waitFor(() =>
      expect(
        runtime.store.getState().runs.byAssistantMessageId[
          assistantMessageDTOFixture.id
        ].status
      ).toBe("completed")
    )
    expect(subscribeAssistantEvents).toHaveBeenCalledTimes(1)
    expect(subscribeAssistantEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId: assistantMessageDTOFixture.id,
        afterEventSequence: 0,
      })
    )
    runtime.destroy()
  })

  it("ThreadMessageLoader 同 Thread 去重、不同 Thread 并行且 destroy 统一 Abort", async () => {
    const store = createThreadChatProjectStore({
      projectId: projectDTOFixture.id,
    })
    store.getState().mergeBootstrap({
      project: projectDTOFixture,
      threadTopology: [rootThreadDTOFixture, branch],
      artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
      initialThread: {
        threadId: rootThreadDTOFixture.id,
        messages: [userMessageDTOFixture, assistantMessageDTOFixture],
        assistantRuns: [assistantRunDTOFixture],
        hasOlderMessages: false,
        oldestReturnedSequence: 1,
        newestReturnedSequence: 2,
      },
    })
    const secondBranch = {
      ...branch,
      id: "00000000-0000-4000-8000-000000000302",
    }
    store.getState().applyThreadCreated(secondBranch)
    const pendingByThread = new Map<
      string,
      ReturnType<typeof deferred<never>>
    >()
    const signals: AbortSignal[] = []
    const loadThreadMessages = vi.fn(
      (input: { threadId: string; signal?: AbortSignal }) => {
        const pending = deferred<never>()
        pendingByThread.set(input.threadId, pending)
        if (input.signal) signals.push(input.signal)
        return pending.promise
      }
    )
    const coordinator = {
      resumeLoadedRuns: vi.fn(),
      subscribeAssistant: vi.fn(),
      unsubscribeAssistant: vi.fn(),
      destroy: vi.fn(),
    } satisfies GenerationCoordinator
    const loader = createThreadMessageLoader({
      projectId: projectDTOFixture.id,
      api: createTestApi({ loadThreadMessages }),
      store,
      generationCoordinator: coordinator,
    })

    const first = loader.ensure(branch.id)
    const duplicate = loader.ensure(branch.id)
    const parallel = loader.ensure(secondBranch.id)
    expect(first).toBe(duplicate)
    expect(parallel).not.toBe(first)
    expect(loadThreadMessages).toHaveBeenCalledTimes(2)
    loader.destroy()
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    pendingByThread.forEach((pending) =>
      pending.reject(new DOMException("Aborted", "AbortError"))
    )
    await Promise.all([first, duplicate, parallel])
    expect(
      store.getState().requests.threadMessagesById[branch.id]
    ).toMatchObject({
      loadState: { status: "loading" },
    })
  })

  it("GenerationCoordinator 按 assistantMessageId 去重、合帧并接收终态", async () => {
    const store = createThreadChatProjectStore({
      projectId: projectDTOFixture.id,
    })
    store.getState().mergeCreationBundle(creationBundleDTOFixture)
    const terminal = deferred<void>()
    const subscribeAssistantEvents = vi.fn(async function* () {
      yield {
        type: "run.snapshot" as const,
        cursor: 0,
        run: { ...assistantRunDTOFixture, status: "running" as const },
        message: assistantMessageDTOFixture,
        artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
      }
      yield {
        type: "run.delta" as const,
        eventSequence: 1,
        chunk: {
          type: "data-run-checkpoint",
          data: { checkpointParts: [{ type: "text", text: "partial" }] },
        },
      }
      await terminal.promise
      yield {
        type: "run.completed" as const,
        eventSequence: 2,
        run: {
          ...assistantRunDTOFixture,
          status: "completed" as const,
          checkpointParts: [{ type: "text", text: "final" }],
          eventSequence: 2,
          finishedAt: "2026-08-25T00:01:00.000Z",
        },
        message: {
          ...assistantMessageDTOFixture,
          parts: [{ type: "text", text: "final" }],
          finalizedAt: "2026-08-25T00:01:00.000Z",
        },
        artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
      }
    })
    const scheduled: Array<() => void> = []
    const coordinator = createGenerationCoordinator({
      api: createTestApi({ subscribeAssistantEvents }),
      store,
      scheduleFlush: (callback) => {
        scheduled.push(callback)
        return vi.fn()
      },
      waitForReconnect: () => Promise.resolve(),
    })
    coordinator.subscribeAssistant(assistantMessageDTOFixture.id)
    coordinator.subscribeAssistant(assistantMessageDTOFixture.id)
    await vi.waitFor(() => expect(scheduled).toHaveLength(1))
    expect(subscribeAssistantEvents).toHaveBeenCalledTimes(1)
    scheduled[0]()
    expect(
      store.getState().runs.byAssistantMessageId[assistantMessageDTOFixture.id]
        .checkpointParts
    ).toEqual([{ type: "text", text: "partial" }])
    terminal.resolve()
    await vi.waitFor(() =>
      expect(
        store.getState().runs.byAssistantMessageId[
          assistantMessageDTOFixture.id
        ].status
      ).toBe("completed")
    )
    expect(
      store.getState().entities.messagesById[assistantMessageDTOFixture.id]
        .parts
    ).toEqual([{ type: "text", text: "final" }])
    coordinator.destroy()
  })

  it("ArtifactLoader 只按 artifactId 请求、缓存并拒绝跨 Project 响应", async () => {
    const store = createThreadChatProjectStore({
      projectId: projectDTOFixture.id,
    })
    store.getState().mergeCreationBundle(creationBundleDTOFixture)
    const artifactId = "00000000-0000-4000-8000-000000000305"
    const loadArtifact = vi.fn().mockResolvedValue({
      id: artifactId,
      projectId: projectDTOFixture.id,
      sourceMessageId: assistantMessageDTOFixture.id,
      kind: "markdown",
      title: "Result",
      content: "# body",
      createdAt: "2026-08-25T00:01:00.000Z",
    })
    const loader = createArtifactLoader({
      projectId: projectDTOFixture.id,
      api: createTestApi({ loadArtifact }),
      store,
    })
    const first = loader.ensure(artifactId)
    const duplicate = loader.ensure(artifactId)
    expect(first).toBe(duplicate)
    await first
    expect(loadArtifact).toHaveBeenCalledTimes(1)
    await loader.ensure(artifactId)
    expect(loadArtifact).toHaveBeenCalledTimes(1)
    expect(store.getState().entities.artifactsById[artifactId].content).toBe(
      "# body"
    )

    const foreignId = "00000000-0000-4000-8000-000000000306"
    loadArtifact.mockResolvedValueOnce({
      id: foreignId,
      projectId: "00000000-0000-4000-8000-000000000999",
      sourceMessageId: assistantMessageDTOFixture.id,
      kind: "markdown",
      title: "Foreign",
      content: "hidden",
      createdAt: "2026-08-25T00:01:00.000Z",
    })
    await loader.ensure(foreignId)
    expect(store.getState().requests.artifactById[foreignId]).toMatchObject({
      status: "error",
      error: { code: "validation_error" },
    })
    expect(store.getState().entities.artifactsById[foreignId]).toBeUndefined()
  })

  it("GenerationCoordinator 网络失败后按持久游标重连，取消订阅不调用 Stop", async () => {
    const store = createThreadChatProjectStore({
      projectId: projectDTOFixture.id,
    })
    store.getState().mergeCreationBundle(creationBundleDTOFixture)
    let attempt = 0
    const subscribeAssistantEvents = vi.fn(async function* (_input: {
      assistantMessageId: string
      afterEventSequence?: number
      signal?: AbortSignal
    }): AsyncGenerator<AssistantMessageEvent> {
      void _input
      attempt++
      if (attempt === 1) throw new Error("disconnected")
      yield {
        type: "run.failed",
        eventSequence: 1,
        run: {
          ...assistantRunDTOFixture,
          status: "failed",
          eventSequence: 1,
          error: { code: "provider_failed", message: "failed" },
          finishedAt: "2026-08-25T00:01:00.000Z",
        },
      }
    })
    const stopAssistant = vi.fn()
    const coordinator = createGenerationCoordinator({
      api: createTestApi({ subscribeAssistantEvents, stopAssistant }),
      store,
      waitForReconnect: () => Promise.resolve(),
    })
    coordinator.subscribeAssistant(assistantMessageDTOFixture.id)
    await vi.waitFor(() =>
      expect(subscribeAssistantEvents).toHaveBeenCalledTimes(2)
    )
    expect(subscribeAssistantEvents.mock.calls[1][0]).toMatchObject({
      assistantMessageId: assistantMessageDTOFixture.id,
      afterEventSequence: 0,
    })
    coordinator.unsubscribeAssistant(assistantMessageDTOFixture.id)
    expect(stopAssistant).not.toHaveBeenCalled()
  })

  it("Application Commands 只提交既有 ID 并用语义 Action 合并响应", async () => {
    const store = createThreadChatProjectStore({
      projectId: projectDTOFixture.id,
    })
    store.getState().mergeCreationBundle(creationBundleDTOFixture)
    const nextUser = {
      ...userMessageDTOFixture,
      id: "00000000-0000-4000-8000-000000000303",
      sequence: 3,
      parts: [{ type: "text", text: "next" }],
    }
    const nextAssistant = {
      ...assistantMessageDTOFixture,
      id: "00000000-0000-4000-8000-000000000304",
      sequence: 4,
    }
    const sendMessage = vi.fn().mockResolvedValue({
      userMessage: nextUser,
      assistantMessage: nextAssistant,
      assistantRun: {
        ...assistantRunDTOFixture,
        assistantMessageId: nextAssistant.id,
      },
    })
    const coordinator = {
      resumeLoadedRuns: vi.fn(),
      subscribeAssistant: vi.fn(),
      unsubscribeAssistant: vi.fn(),
      destroy: vi.fn(),
    } satisfies GenerationCoordinator
    const api = createTestApi({ sendMessage })
    const result = createThreadChatProjectCommands({
      projectId: projectDTOFixture.id,
      api,
      store,
      messageLoader: { ensure: vi.fn(), destroy: vi.fn() },
      artifactLoader: { ensure: vi.fn(), destroy: vi.fn() },
      generationCoordinator: coordinator,
    })
    await result.commands.sendMessage(rootThreadDTOFixture.id, [
      { type: "text", text: "next" },
    ])
    expect(sendMessage).toHaveBeenCalledWith({
      threadId: rootThreadDTOFixture.id,
      parts: [{ type: "text", text: "next" }],
      requestedModelId: undefined,
    })
    expect(JSON.stringify(sendMessage.mock.calls[0][0])).not.toContain(
      nextAssistant.id
    )
    expect(store.getState().entities.messagesById[nextAssistant.id]).toEqual(
      nextAssistant
    )
    expect(coordinator.subscribeAssistant).toHaveBeenCalledWith(
      nextAssistant.id
    )
  })

  it("Registry 用一次 seed handoff 交付同一 Runtime并抵抗同 tick lease 重挂载", async () => {
    const api = createTestApi()
    const registry = createProjectRuntimeRegistry({
      createRuntime: (projectId) =>
        createThreadChatProjectRuntime({
          projectId,
          api,
          waitForReconnect: () => new Promise(() => {}),
        }),
    })
    const seeded = registry.seedFromCreation(creationBundleDTOFixture)
    const acquired = registry.acquire(projectDTOFixture.id)
    expect(acquired).toBe(seeded)
    expect(acquired.store.getState().requests.bootstrap.status).toBe("ready")
    registry.release(projectDTOFixture.id)
    expect(registry.acquire(projectDTOFixture.id)).toBe(seeded)
    await Promise.resolve()
    expect(registry.peek(projectDTOFixture.id)).toBe(seeded)
    registry.release(projectDTOFixture.id)
    await Promise.resolve()
    expect(registry.peek(projectDTOFixture.id)).toBeNull()
  })
})
