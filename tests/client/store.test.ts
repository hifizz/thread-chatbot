import { describe, expect, it } from "vitest"
import { createThreadChatAppStore } from "@/lib/thread-chat/client/app-store"
import { createThreadChatProjectStore } from "@/lib/thread-chat/client/project-store"
import {
  selectForkAvailability,
  selectThreadColumnView,
  selectThreadMessages,
} from "@/lib/thread-chat/client/selectors"
import {
  assistantMessageDTOFixture,
  assistantRunDTOFixture,
  creationBundleDTOFixture,
  projectDTOFixture,
  rootThreadDTOFixture,
  userMessageDTOFixture,
} from "../fixtures/thread-chat-api-fixtures"

const branchId = "00000000-0000-4000-8000-000000000201"

const branch = {
  ...rootThreadDTOFixture,
  id: branchId,
  parentThreadId: rootThreadDTOFixture.id,
  sourceMessageId: userMessageDTOFixture.id,
  forkSourceSnapshot: {
    schemaVersion: 1 as const,
    sourceRole: "user" as const,
    sourceSequence: 1,
  },
}

describe("ThreadChat client stores", () => {
  it("App Store 合并稳定排序的摘要且不保存 selectedProjectId", () => {
    const store = createThreadChatAppStore()
    expect(store.getState().catalog.loadState.status).toBe("idle")
    expect("selectedProjectId" in store.getState()).toBe(false)
    store.getState().mergeProjectPage({
      items: [
        {
          id: projectDTOFixture.id,
          displayTitle: "First",
          archivedAt: null,
          updatedAt: "2026-08-25T00:00:00.000Z",
          threadCount: 1,
          messageCount: 2,
        },
        {
          id: "00000000-0000-4000-8000-000000000200",
          displayTitle: "Second",
          archivedAt: null,
          updatedAt: "2026-08-26T00:00:00.000Z",
          threadCount: 1,
          messageCount: 0,
        },
      ],
      nextCursor: "cursor",
    })
    expect(store.getState().catalog.orderedProjectIds).toEqual([
      "00000000-0000-4000-8000-000000000200",
      projectDTOFixture.id,
    ])
    store.getState().setCatalogFilter("archived")
    expect(store.getState().catalog).toMatchObject({
      activeFilter: "archived",
      orderedProjectIds: [],
      nextCursor: null,
      loadState: { status: "idle" },
    })
  })

  it("Creation、Message 与 replacement 由 normalizer 原子合并", () => {
    const store = createThreadChatProjectStore({
      projectId: projectDTOFixture.id,
    })
    store.getState().mergeCreationBundle(creationBundleDTOFixture)
    expect(store.getState()).toMatchObject({
      requests: {
        bootstrap: { status: "ready" },
        threadMessagesById: {
          [rootThreadDTOFixture.id]: { loadState: { status: "ready" } },
        },
      },
      ui: { focusedSlotId: "root" },
    })
    expect(
      selectThreadMessages(store.getState(), rootThreadDTOFixture.id)
    ).toEqual([userMessageDTOFixture, assistantMessageDTOFixture])

    store.getState().applyMessageBundle({
      threadId: rootThreadDTOFixture.id,
      messages: [assistantMessageDTOFixture, userMessageDTOFixture],
      assistantRuns: [assistantRunDTOFixture],
      hasOlderMessages: false,
      oldestReturnedSequence: 1,
      newestReturnedSequence: 2,
    })
    expect(
      store.getState().entities.messageIdsByThreadId[rootThreadDTOFixture.id]
    ).toEqual([userMessageDTOFixture.id, assistantMessageDTOFixture.id])

    const replacement = {
      ...assistantMessageDTOFixture,
      id: "00000000-0000-4000-8000-000000000203",
      sequence: 3,
      replacesMessageId: assistantMessageDTOFixture.id,
    }
    store.getState().applyReplacementBundle({
      supersededMessageIds: [assistantMessageDTOFixture.id],
      createdMessages: [replacement],
      assistantRun: {
        ...assistantRunDTOFixture,
        assistantMessageId: replacement.id,
      },
    })
    expect(
      selectThreadMessages(store.getState(), rootThreadDTOFixture.id).map(
        (message) => message.id
      )
    ).toEqual([userMessageDTOFixture.id, replacement.id])
  })

  it("拒绝跨 Project 归属与 duplicate sequence", () => {
    const store = createThreadChatProjectStore({
      projectId: projectDTOFixture.id,
    })
    store.getState().mergeCreationBundle(creationBundleDTOFixture)
    expect(() =>
      store.getState().applyThreadCreated({
        ...branch,
        projectId: "00000000-0000-4000-8000-000000000999",
      })
    ).toThrow(/another Project/)
    expect(() =>
      store.getState().applyMessageBundle({
        threadId: rootThreadDTOFixture.id,
        messages: [
          {
            ...assistantMessageDTOFixture,
            id: "00000000-0000-4000-8000-000000000204",
            sequence: 1,
          },
        ],
        assistantRuns: [
          {
            ...assistantRunDTOFixture,
            assistantMessageId: "00000000-0000-4000-8000-000000000204",
          },
        ],
        hasOlderMessages: false,
        oldestReturnedSequence: 1,
        newestReturnedSequence: 1,
      })
    ).toThrow(/duplicate Message sequence/)
  })

  it("稳定 Column Slot、宽度、折叠和 Snapshot 过滤非法视图", () => {
    const store = createThreadChatProjectStore({
      projectId: projectDTOFixture.id,
      generateSlotId: () => "slot-1",
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
    store.getState().openThread(branch.id, "root")
    store.getState().commitColumnWidths({ "slot-1": 420 })
    store.getState().switchColumnThread("slot-1", branch.id)
    expect(store.getState().ui.columnSlots[0]).toMatchObject({
      slotId: "slot-1",
      threadId: branch.id,
      widthPx: 420,
    })
    store.getState().setColumnFolded("slot-1", true)
    expect(store.getState().ui.focusedSlotId).toBe("root")
    store.getState().restoreWorkbenchSnapshot({
      schemaVersion: 1,
      columnSlots: [
        { slotId: "slot-1", threadId: branch.id, folded: false, widthPx: 360 },
        {
          slotId: "duplicate",
          threadId: branch.id,
          folded: false,
          widthPx: 360,
        },
        {
          slotId: "foreign",
          threadId: "00000000-0000-4000-8000-000000000999",
          folded: false,
          widthPx: 360,
        },
      ],
      focusedSlotId: "duplicate",
      rootColumnWidthPx: 500,
      forceColumnCount: 3,
      placementMode: "fold",
      viewMode: "canvas",
      canvasPins: {
        [branch.id]: { x: 12, y: 20 },
        "00000000-0000-4000-8000-000000000999": { x: 2, y: 3 },
      },
    })
    expect(store.getState().ui).toMatchObject({
      columnSlots: [{ slotId: "slot-1", threadId: branch.id, widthPx: 360 }],
      focusedSlotId: "slot-1",
      rootColumnWidthPx: 500,
      placementMode: "fold",
      viewMode: "canvas",
      canvasPins: { [branch.id]: { x: 12, y: 20 } },
    })
  })

  it("局部 Run、Artifact Summary 与 Column View 不依赖 Artifact 正文", () => {
    const store = createThreadChatProjectStore({
      projectId: projectDTOFixture.id,
    })
    store.getState().mergeCreationBundle(creationBundleDTOFixture)
    store.getState().applyRunEvent({
      type: "run.snapshot",
      cursor: 0,
      run: assistantRunDTOFixture,
      message: assistantMessageDTOFixture,
      artifactSummary: { changeSequence: 2, total: 1, byKind: { markdown: 1 } },
    })
    store.getState().applyRunEvent({
      type: "run.snapshot",
      cursor: 0,
      run: assistantRunDTOFixture,
      message: assistantMessageDTOFixture,
      artifactSummary: { changeSequence: 1, total: 0, byKind: {} },
    })
    expect(store.getState().readModels.artifactSummary?.changeSequence).toBe(2)
    expect(() =>
      store.getState().applyRunEvent({
        type: "run.snapshot",
        cursor: 0,
        run: assistantRunDTOFixture,
        message: assistantMessageDTOFixture,
        artifactSummary: {
          changeSequence: 2,
          total: 2,
          byKind: { markdown: 2 },
        },
      })
    ).toThrow(/without advancing changeSequence/)
    expect(
      selectForkAvailability(store.getState(), assistantMessageDTOFixture.id)
    ).toEqual({ allowed: false, reason: "message_not_finalized" })
    expect(selectThreadColumnView(store.getState(), "root")).toMatchObject({
      status: "ready",
      artifactIds: [],
    })
  })
})
