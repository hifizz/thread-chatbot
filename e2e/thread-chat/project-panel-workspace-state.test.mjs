import assert from "node:assert/strict"
import { createConversationStore } from "../../app/thread-chat/core/store.ts"

const projectId = crypto.randomUUID()
const rootThreadId = crypto.randomUUID()
const assistantId = crypto.randomUUID()
const now = new Date().toISOString()

function bootstrap({ version = 1, fileId = crypto.randomUUID(), artifactId = crypto.randomUUID() } = {}) {
  return {
    project: {
      id: projectId,
      rootThreadId,
      autoTitle: "Workspace",
      customTitle: null,
      target: `Target v${version}`,
      instructions: `Instructions v${version}`,
      contractVersion: version,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    files: [
      {
        projectId,
        attachmentId: fileId,
        filename: `file-${version}.pdf`,
        mimeType: "application/pdf",
        size: 42,
        kind: "document",
        status: "ready",
        pageCount: 1,
        summary: null,
        suggestedQuestions: null,
        error: null,
        url: `/api/attachments/${fileId}`,
        addedAt: now,
        createdAt: now,
      },
    ],
    threads: [
      {
        id: rootThreadId,
        projectId,
        parentId: null,
        forkMessageId: null,
        forkContext: [],
        forkAnchor: null,
        anchorText: null,
        footnote: null,
        depth: 0,
        modelId: "test-model",
        autoTitle: "Workspace",
        customTitle: null,
        titleGenerationAttempted: true,
        titleGenerated: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    messages: [
      {
        id: assistantId,
        projectId,
        threadId: rootThreadId,
        sequence: 1,
        role: "assistant",
        parts: [],
        status: "generating",
        modelId: "test-model",
        replacesMessageId: null,
        supersededAt: null,
        feedback: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        finishedAt: null,
      },
    ],
    artifacts: [
      {
        id: artifactId,
        projectId,
        threadId: rootThreadId,
        sourceMessageId: assistantId,
        sourceThreadTitle: "Workspace",
        sourceThreadFootnote: null,
        sourceMessageStatus: "generating",
        kind: "markdown",
        title: `Artifact v${version}`,
        content: "# Result",
        language: null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeGenerationIds: [assistantId],
  }
}

const initialWorkspace = {
  view: "canvas",
  openThreadIds: [rootThreadId],
  columnSlots: [{ threadId: rootThreadId, folded: false }],
  columnWidths: { [rootThreadId]: 640 },
  forceColumns: 2,
  placementMode: "fold",
  selectedThreadId: rootThreadId,
  recents: [rootThreadId],
  canvas: {
    pins: { [rootThreadId]: { x: 123, y: 456 } },
    viewport: { x: 30, y: 40, zoom: 0.8 },
  },
  panelSizes: { projectPanel: 520 },
  expandedNodes: [rootThreadId],
}

const first = bootstrap()
const store = createConversationStore({
  bootstrap: first,
  workspace: initialWorkspace,
})
const before = structuredClone(store.getState().workspace)

// Project Panel refresh uses hydrateProject. Entity resources must refresh while the
// independent columns/canvas workspace state remains byte-for-byte stable.
const second = bootstrap({ version: 2 })
store.getState().hydrateProject(second)

assert.deepEqual(store.getState().workspace, before)
assert.equal(store.getState().project.contractVersion, 2)
assert.equal(store.getState().projectFileOrder.length, 1)
assert.equal(store.getState().artifactOrder.length, 1)
assert.equal(
  store.getState().streamByMessageId[assistantId].phase,
  "background",
  "刷新 Bootstrap 时正在生成的 SSE 应恢复为后台可继续订阅状态"
)

// 列视图/窄屏等 workspace 修改也与 Project 实体刷新正交。
store.getState().setWorkspace({ view: "columns", forceColumns: 1 })
const narrowBefore = structuredClone(store.getState().workspace)
store.getState().hydrateProject(bootstrap({ version: 3 }))
assert.deepEqual(store.getState().workspace, narrowBefore)

console.log("project panel workspace-state tests passed")
