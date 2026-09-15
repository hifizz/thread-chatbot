import assert from "node:assert/strict"
import { currentProjectArtifacts, currentDocumentArtifact } from "../../lib/thread-chat/domain/documents/current-artifacts.ts"

const artifact = (id, revisionNumber, overrides = {}) => ({
  id, title: "F1", kind: "markdown", sourceMessageStatus: "completed",
  createdAt: `2026-09-15T00:00:0${revisionNumber}.000Z`, content: `body-${id}`,
  document: { id: "document-1", revisionId: id, revisionNumber, currentRevisionId: "r3" },
  ...overrides,
})
const r1 = artifact("r1", 1)
const r2 = artifact("r2", 2)
const r3 = artifact("r3", 3)
assert.deepEqual(currentProjectArtifacts([r2, r3, r1]), [r3])
assert.equal(currentDocumentArtifact([r1, r2, r3], "document-1"), r3)
assert.equal(currentDocumentArtifact([r1, r2], "document-1"), null, "missing head must not silently fall back")
const other = artifact("other", 1, { document: { id: "document-2", revisionId: "other", revisionNumber: 1, currentRevisionId: "other" } })
assert.equal(currentProjectArtifacts([r1, r2, r3, other]).length, 2, "same title does not mean same document")
const failed = { ...r3, sourceMessageStatus: "failed" }
assert.deepEqual(currentProjectArtifacts([r1, r2, failed]), [failed], "source qualification must not select an old completed version")
const staleMetadata = { ...r1, document: { ...r1.document, currentRevisionId: "r1" } }
assert.deepEqual(currentProjectArtifacts([staleMetadata, r3]), [r3], "stream arrival before old metadata refresh")
const standalone = artifact("legacy", 1, { document: undefined })
assert.equal(currentProjectArtifacts([r1, r3, standalone]).length, 2)
assert.equal(r1.content, "body-r1", "fixed snapshots remain unchanged")
assert.equal(currentDocumentArtifact([r1, r3], "unknown"), null)
console.log("PASS 当前文档目录：多版本单入口、同名身份、head 缺失、流式刷新、来源资格与固定历史")
