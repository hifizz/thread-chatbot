import assert from "node:assert/strict"
import { selectCurrentProjectArtifacts, selectCurrentDocumentArtifact } from "../../lib/thread-chat/domain/artifacts/selectors.ts"

const artifact = (id, revisionNumber, overrides = {}) => ({
  id, title: "F1", kind: "markdown", sourceMessageStatus: "completed",
  createdAt: `2026-09-15T00:00:0${revisionNumber}.000Z`, content: `body-${id}`,
  document: { id: "document-1", revisionId: id, revisionNumber },
  ...overrides,
})
const r1 = artifact("r1", 1)
const r2 = artifact("r2", 2)
const r3 = artifact("r3", 3)
const document = { id: "document-1", currentArtifactId: "r3", currentRevisionId: "r3", sourceMessageStatus: "completed" }
const catalog = (items, documents = [document]) => ({ artifactsById: Object.fromEntries(items.map(a => [a.id, a])), documentsById: Object.fromEntries(documents.map(d => [d.id, d])) })
assert.deepEqual(selectCurrentProjectArtifacts(catalog([r2, r3, r1])), [r3])
assert.deepEqual(selectCurrentDocumentArtifact(catalog([r1, r2, r3]), document.id), r3)
assert.equal(selectCurrentDocumentArtifact(catalog([r1, r2]), document.id), null)
const other = artifact("other", 1, { document: { id: "document-2", revisionId: "other", revisionNumber: 1 } })
assert.equal(selectCurrentProjectArtifacts(catalog([r1, r2, r3, other], [document, { ...document, id: "document-2", currentArtifactId: "other" }])).length, 2)
assert.equal(selectCurrentProjectArtifacts(catalog([r1, r3], [{ ...document, sourceMessageStatus: "failed" }]))[0].sourceMessageStatus, "failed")
const stale = { ...r3, sourceMessageStatus: "generating" }
assert.equal(selectCurrentProjectArtifacts(catalog([r1, stale]))[0].sourceMessageStatus, "completed")
assert.equal(stale.sourceMessageStatus, "generating", "directory metadata does not mutate fixed cache")
assert.deepEqual(selectCurrentProjectArtifacts(catalog([r1, r3], [])), [], "cache alone cannot invent current documents")
assert.equal(r1.content, "body-r1")
assert.equal(selectCurrentDocumentArtifact(catalog([r1, r3]), "unknown"), null)
console.log("PASS 当前文档目录：权威 head、同名身份、未加载正文、来源状态刷新、固定历史")

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
assert.deepEqual(selectCurrentProjectArtifacts(catalog(Object.values(tree.artifacts))).map(a => a.id), ["r3"])
tree.threads.main.activeLeafMessageId = "answer-2"
assert.deepEqual(selectArtifactsOnSelectedMessagePaths(tree).map(a => a.id), ["r3"])
tree.threads.main.activeLeafMessageId = null
assert.deepEqual(selectArtifactsOnSelectedMessagePaths(tree), [])
const selectors = await import("../../lib/thread-chat/domain/selectors.ts")
assert.equal(selectors.selectArtifactsOnSelectedMessagePaths, selectArtifactsOnSelectedMessagePaths)
assert.equal(selectors.selectCurrentProjectArtifacts, selectCurrentProjectArtifacts)
console.log("PASS 产物查询职责：选中消息路径保留固定历史，当前目录只取 head；统一入口转导出")
