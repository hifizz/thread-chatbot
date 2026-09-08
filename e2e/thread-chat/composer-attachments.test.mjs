import assert from "node:assert/strict"
import { appendComposerAttachments } from "../../lib/thread-chat/composer-attachments.ts"
import { composerDraftToMessageContent } from "../../lib/thread-chat/composer-draft-adapter.ts"

const file = new File(["验收文件"], "same-name.txt", { type: "text/plain" })
const ready = (id) => ({ id, file, status: "ready", uploaded: { serverId: id, reference: { url: `/api/attachments/${id}`, mediaType: file.type, filename: file.name } } })
const draft = { parts: [{ localId: "text", type: "text", text: "阅读这些附件" }, { localId: "mention", type: "artifact-reference", artifactId: crypto.randomUUID() }] }
const attachments = [ready("first"), ready("second")]
const combined = appendComposerAttachments(draft, attachments)
assert.deepEqual(combined.parts.slice(0, 2), draft.parts)
assert.deepEqual(combined.parts.slice(2).map((part) => part.file.url), ["/api/attachments/first", "/api/attachments/second"])
assert.equal(draft.parts.length, 2, "发送组装不修改编辑器草稿")
const content = composerDraftToMessageContent(combined)
assert.deepEqual(content.parts.slice(2), attachments.map((item) => ({ type: "file", file: item.uploaded.reference })))
assert.ok(!JSON.stringify(content).includes("localId"))
for (const pending of [{ id: "pending", file, status: "uploading", progress: 0.5 }, { id: "failed", file, status: "error", error: "offline" }]) {
  assert.throws(() => appendComposerAttachments(draft, [ready("first"), pending]), /等待附件上传完成/)
}
console.log("PASS 附件发送：同名文件独立身份、保留 Artifact 顺序、上传和失败状态阻止发送")
