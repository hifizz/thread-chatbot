import assert from "node:assert/strict"
import { selectCurrentProjectArtifacts, selectCurrentDocumentArtifact } from "../../lib/thread-chat/domain/artifacts/selectors.ts"

const artifact = (id, revisionNumber, overrides = {}) => ({
  id, title: "F1", kind: "markdown", sourceMessageStatus: "completed",
  createdAt: `2026-09-15T00:00:0${revisionNumber}.000Z`, content: `body-${id}`,
  document: { id: "document-1", revisionId: id, revisionNumber, currentRevisionId: "r3" },
  ...overrides,
})
const r1 = artifact("r1", 1)
const r2 = artifact("r2", 2)
const r3 = artifact("r3", 3)
assert.deepEqual(selectCurrentProjectArtifacts([r2, r3, r1]), [r3])
assert.equal(selectCurrentDocumentArtifact([r1, r2, r3], "document-1"), r3)
assert.equal(selectCurrentDocumentArtifact([r1, r2], "document-1"), null, "missing head must not silently fall back")
const other = artifact("other", 1, { document: { id: "document-2", revisionId: "other", revisionNumber: 1, currentRevisionId: "other" } })
assert.equal(selectCurrentProjectArtifacts([r1, r2, r3, other]).length, 2, "same title does not mean same document")
const failed = { ...r3, sourceMessageStatus: "failed" }
assert.deepEqual(selectCurrentProjectArtifacts([r1, r2, failed]), [failed], "source qualification must not select an old completed version")
const staleMetadata = { ...r1, document: { ...r1.document, currentRevisionId: "r1" } }
assert.deepEqual(selectCurrentProjectArtifacts([staleMetadata, r3]), [r3], "stream arrival before old metadata refresh")
const standalone = artifact("legacy", 1, { document: undefined })
assert.equal(selectCurrentProjectArtifacts([r1, r3, standalone]).length, 2)
assert.equal(r1.content, "body-r1", "fixed snapshots remain unchanged")
assert.equal(selectCurrentDocumentArtifact([r1, r3], "unknown"), null)
console.log("PASS 当前文档目录：多版本单入口、同名身份、head 缺失、流式刷新、来源资格与固定历史")

// 消息路径与文档 head 是两个维度：原路径应保留旧产物，而不是被当前目录过滤。
const { selectArtifactsOnSelectedMessagePaths } = await import("../../lib/thread-chat/domain/artifacts/selectors.ts")
const tree = {
  threads: { main: { activeLeafMessageId: "answer-1", messages: [
    { id: "question", parentMessageId: null },
    { id: "answer-1", parentMessageId: "question" },
    { id: "answer-2", parentMessageId: "question" },
  ] } },
  artifacts: {
    r1: { ...r1, sourceMessageId: "answer-1" },
    r3: { ...r3, sourceMessageId: "answer-2" },
  },
  artifactOrder: ["missing", "r1", "r3"],
}
assert.deepEqual(selectArtifactsOnSelectedMessagePaths(tree).map(a => a.id), ["r1"])
assert.deepEqual(selectCurrentProjectArtifacts(Object.values(tree.artifacts)).map(a => a.id), ["r3"])
tree.threads.main.activeLeafMessageId = "answer-2"
assert.deepEqual(selectArtifactsOnSelectedMessagePaths(tree).map(a => a.id), ["r3"])
tree.threads.main.activeLeafMessageId = null
assert.deepEqual(selectArtifactsOnSelectedMessagePaths(tree), [])
const selectors = await import("../../lib/thread-chat/domain/selectors.ts")
assert.equal(selectors.selectArtifactsOnSelectedMessagePaths, selectArtifactsOnSelectedMessagePaths)
assert.equal(selectors.selectCurrentProjectArtifacts, selectCurrentProjectArtifacts)
console.log("PASS 产物查询职责：选中消息路径保留固定历史，当前目录只取 head；统一入口转导出")
