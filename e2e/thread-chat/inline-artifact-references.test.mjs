import assert from "node:assert/strict"
import { createEditor, $getRoot } from "lexical"
import { convertToModelMessages } from "ai"
import { PgDialect } from "drizzle-orm/pg-core"
import {
  artifactReferenceInputSchema, artifactReferenceData,
  assertArtifactReferenceBudget, expandArtifactReferenceParts,
} from "../../lib/thread-chat/contracts/artifact-reference.ts"
import {
  messageContentInputSchema, composerDraftToMessageContent,
  messageContentToUiParts, messagePartsToContent,
} from "../../lib/thread-chat/contracts/message-content.ts"
import { loadReferenceArtifacts, resolveUserMessageParts } from "../../lib/thread-chat/application/artifact-reference-resolution.ts"
import { ARTIFACT_REFERENCE_MAX_CHARS } from "../../constants/artifact-reference.ts"
import { ArtifactReferenceNode } from "../../app/thread-chat/chat/composer/artifact-reference-node.ts"
import { $readInlineDocument, $writeInlineDocument } from "../../app/thread-chat/chat/composer/inline-editor-document.ts"

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const project = id(1)
const makeArtifact = (n, overrides = {}) => ({
  id: id(n), projectId: project, threadId: id(n + 10), sourceMessageId: id(n + 20),
  kind: "markdown", title: "同名产物", content: `完整正文 ${n}\n末尾校验文字`,
  ...overrides,
})
const self = makeArtifact(2)
const sibling = makeArtifact(3)
const deepBranch = makeArtifact(4)
const byId = new Map([self, sibling, deepBranch].map((a) => [a.id, a]))
const ref = (artifact) => ({ type: "artifact-reference", artifactId: artifact.id })
const text = (value) => ({ type: "text", text: value })
const inline = [text("对照 "), ref(deepBranch), text(" 与 "), ref(self), text("，再检查 "), ref(deepBranch), text("。")]
const quote = { type: "quote", quote: {
  schemaVersion: "thread-quote-v1", text: "原文", source: {
    type: "message", messageId: id(50), anchor: {
      quote: { exact: "原文", prefix: "", suffix: "" }, position: { start: 0, end: 2 },
    },
  },
} }
const file = { type: "file", file: { url: `/api/attachments/${id(60)}`, mediaType: "text/plain", filename: "资料.txt" } }
const parts = [quote, ...inline, file]
assert.equal(artifactReferenceInputSchema.safeParse({ ...ref(self), title: "伪造", content: "伪造正文" }).success, false)
assert.equal(messageContentInputSchema.safeParse({ parts: [ref(self)] }).success, false)
const content = messageContentInputSchema.parse({ parts })
const persisted = messageContentToUiParts(content, (key) => artifactReferenceData(byId.get(key)))
assert.deepEqual(messagePartsToContent(persisted), parts, "历史消息/编辑/重试保留有序引用、Quote 和附件")
const draft = composerDraftToMessageContent({ parts: inline.map((part, i) => ({ ...part, localId: String(i) })) })
assert.deepEqual(draft.parts, inline)
assert.throws(() => messageContentToUiParts({ parts: inline }), /服务端解析/)

const original = structuredClone(persisted)
const expanded = expandArtifactReferenceParts(persisted, byId)
assert.deepEqual(persisted, original, "模型展开不改写历史 Parts")
assert.equal(JSON.parse(expanded[2].text).content, deepBranch.content)
assert.equal(JSON.parse(expanded[4].text).content, self.content)
assert.equal(JSON.parse(expanded[6].text).previouslyIncludedInThisMessage, true)
assert.equal("content" in JSON.parse(expanded[6].text), false, "同条消息重复引用只展开一次正文")
const model = await convertToModelMessages([{ id: id(70), role: "user", parts: expandArtifactReferenceParts(persisted.slice(1, -1), byId) }])
assert.deepEqual(model[0].content.map((p) => p.text), expanded.slice(1, -1).map((p) => p.text), "模型接收到文字与完整正文原序")
const regenerated = new Map(byId).set(id(99), makeArtifact(99, { title: self.title, content: "重新生成正文" }))
assert.deepEqual(expandArtifactReferenceParts(persisted, regenerated), expanded, "同名重生成不改变原引用身份")
assert.deepEqual(expandArtifactReferenceParts(persisted, byId), expanded, "后续轮次不改变历史展开")
assertArtifactReferenceBudget([self.id, self.id], byId)
assert.throws(() => assertArtifactReferenceBudget(Array(21).fill(self.id), byId), /20/)
assert.throws(() => assertArtifactReferenceBudget([id(999)], byId), /不可用|不存在|读取/)
const large = makeArtifact(80, { content: "文".repeat(ARTIFACT_REFERENCE_MAX_CHARS) })
assert.throws(() => assertArtifactReferenceBudget([large.id], new Map([[large.id, large]])), /内容过长/)

// 使用真实 Drizzle SQL 构建器检查作用域；executor 是测试替身，不连接数据库。
const dialect = new PgDialect()
let joins = ""
const rows = [self, sibling, deepBranch, makeArtifact(5, { projectId: id(500) })]
function executor(status = "completed") {
  return { select() { return { from() { return { innerJoin(_table, condition) {
    joins = dialect.sqlToQuery(condition).sql
    return { async where(condition) {
      const query = dialect.sqlToQuery(condition)
      assert.match(query.sql, /"project_id" = /)
      assert.match(query.sql, /"id" in /)
      assert.doesNotMatch(query.sql, /thread_id|superseded_at/, "引用范围不限制 Thread 或历史来源")
      const [scope, ...ids] = query.params
      return rows.filter((a) => a.projectId === scope && ids.includes(a.id)).map((artifact) => ({ artifact, status }))
    } }
  } } } } } }
}
const resolved = await loadReferenceArtifacts(executor(), project, [self.id, sibling.id, deepBranch.id])
assert.deepEqual([...resolved.keys()], [self.id, sibling.id, deepBranch.id], "同 Project 允许当前、兄弟、深层 Thread")
assert.match(joins, /"source_message_id"/)
assert.match(joins, /"thread_id"/)
assert.match(joins, /"project_id"/)
await assert.rejects(loadReferenceArtifacts(executor(), project, [id(5)]), { code: "NOT_FOUND" })
await assert.rejects(loadReferenceArtifacts(executor(), id(501), [self.id]), { code: "NOT_FOUND" })
await assert.rejects(loadReferenceArtifacts(executor("streaming"), project, [self.id], true), { code: "STATE_CONFLICT" })
await assert.rejects(loadReferenceArtifacts(executor("failed"), project, [self.id], true), { code: "STATE_CONFLICT" })
assert.deepEqual(await resolveUserMessageParts(executor(), project, content), persisted)
assert.equal((await loadReferenceArtifacts(executor(), project, [self.id, self.id])).size, 1)

const editor = createEditor({ namespace: "artifact-test", nodes: [ArtifactReferenceNode], onError(error) { throw error } })
editor.update(() => $writeInlineDocument(inline, (key) => byId.get(key).title), { discrete: true })
assert.deepEqual(editor.getEditorState().read($readInlineDocument), inline)
assert.equal(editor.getEditorState().read(() => $getRoot().getAllTextNodes().filter((n) => n instanceof ArtifactReferenceNode).every((n) => n.isToken())), true)
const serialized = JSON.stringify(editor.getEditorState().toJSON())
const restored = createEditor({ namespace: "artifact-test", nodes: [ArtifactReferenceNode], onError(error) { throw error } })
restored.setEditorState(restored.parseEditorState(serialized))
assert.deepEqual(restored.getEditorState().read($readInlineDocument), inline, "编辑器结构化序列化保留同名身份和重复位置")
editor.update(() => $writeInlineDocument([text("mail@example.com\n@普通文字")], () => ""), { discrete: true })
assert.deepEqual(editor.getEditorState().read($readInlineDocument), [text("mail@example.com\n@普通文字")], "普通 @ 文本不隐式升级为引用")
console.log("PASS inline artifacts: ordered protocol, full model bodies, deduplication, project SQL scope, lifecycle, budgets and Lexical round-trip")

// 客户端真实命令层：网络失败仍能检查原序 payload、乐观展示和回滚。
const { createConversationStore } = await import("../../app/thread-chat/core/store.ts")
const { createConversationCommands } = await import("../../app/thread-chat/net/commands/conversation-commands.ts")
const stamp = "2026-09-06T00:00:00.000Z"
const projectDTO = { id: project, rootThreadId: self.threadId, autoTitle: "项目", customTitle: null, archivedAt: null, createdAt: stamp, updatedAt: stamp }
const threadDTO = { id: self.threadId, projectId: project, parentId: null, forkMessageId: null, forkContext: [], forkAnchor: null, anchorText: null, footnote: null, depth: 0, modelId: "test/model", autoTitle: "当前 Thread", customTitle: null, titleGenerationAttempted: true, titleGenerated: true, createdAt: stamp, updatedAt: stamp }
const oldUser = { id: id(90), projectId: project, threadId: self.threadId, sequence: 1, role: "user", parts: persisted, status: "completed", modelId: null, replacesMessageId: null, supersededAt: null, feedback: null, error: null, createdAt: stamp, updatedAt: stamp, finishedAt: stamp }
const store = createConversationStore({ bootstrap: { project: projectDTO, files: [], threads: [threadDTO], messages: [oldUser], artifacts: [...byId.values()], activeGenerationIds: [] } })
let seenCommand
const failRequest = async (_id, command) => {
  seenCommand = command
  const userId = command.firstTurn?.userMessageId ?? command.userMessageId
  const expected = command.firstTurn?.parts ?? command.parts
  assert.deepEqual(messagePartsToContent(store.getState().messagesById[userId].parts), expected, "乐观消息保留引用顺序")
  throw new Error("模拟离线")
}
const commands = createConversationCommands({ store, networkAttempts: 1, client: { sendMessage: failRequest, editMessage: failRequest, forkThread: failRequest } })
await assert.rejects(commands.sendMessage({ threadId: self.threadId, modelId: "test/model", text: "对照", parts }), /模拟离线/)
assert.deepEqual(seenCommand.parts, parts)
assert.equal(store.getState().messagesById[seenCommand.userMessageId], undefined, "发送失败移除乐观消息")
await assert.rejects(commands.editLatestTurn({ userMessageId: oldUser.id, modelId: "test/model", text: "对照", parts }), /模拟离线/)
assert.deepEqual(seenCommand.parts, parts)
assert.deepEqual(store.getState().messagesById[oldUser.id].parts, persisted)
assert.equal(store.getState().messagesById[oldUser.id].supersededAt, null, "编辑失败恢复旧消息")
await assert.rejects(commands.forkThread({ parentThreadId: self.threadId, sourceMessageId: id(55), anchorText: "原文", anchor: quote.quote.source.anchor, modelId: "test/model", text: "对照", parts: inline }), /模拟离线/)
assert.deepEqual(seenCommand.firstTurn.parts.slice(1), inline, "分支首轮不丢弃行内引用")
commands.dispose()
console.log("PASS inline artifact send/edit/fork command payloads and optimistic rollback")

const { matchArtifactTrigger, artifactReferenceCandidates } = await import("../../app/thread-chat/chat/composer/artifact-typeahead.ts")
assert.deepEqual(matchArtifactTrigger("参考@研究"), { leadOffset: 2, matchingString: "研究", replaceableString: "@研究" })
assert.deepEqual(matchArtifactTrigger("compare @"), { leadOffset: 8, matchingString: "", replaceableString: "@" })
assert.equal(matchArtifactTrigger("mail@example.com"), null)
assert.equal(matchArtifactTrigger("hello @@"), null)
const candidates = [...byId.values()].map((a, i) => ({ ...a, createdAt: stamp, sourceMessageStatus: "completed", sourceThreadTitle: ["当前 Thread", "兄弟分支", "深层分支"][i] }))
assert.deepEqual(artifactReferenceCandidates([...candidates, { ...candidates[0], id: id(100), sourceMessageStatus: "generating" }], "").map((a) => a.id), [...byId.keys()])
assert.deepEqual(artifactReferenceCandidates(candidates, "兄弟").map((a) => a.id), [sibling.id])
const { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes } = await import("@lexical/clipboard")
let clipboardPayload
restored.update(() => {
  const selection = $getRoot().select(0, $getRoot().getChildrenSize())
  clipboardPayload = $generateJSONFromSelectedNodes(restored, selection)
}, { discrete: true })
editor.update(() => {
  const selection = $getRoot().clear().selectEnd()
  selection.insertNodes($generateNodesFromSerializedNodes(clipboardPayload.nodes))
}, { discrete: true })
assert.deepEqual(editor.getEditorState().read($readInlineDocument), inline, "结构化剪贴板保留文字和多次引用的位置与 ID")
console.log("PASS inline artifact Chinese triggers, candidate scope and structured clipboard")

const { $setSelection } = await import("lexical")
const { $insertInlineText } = await import("../../app/thread-chat/chat/composer/inline-editor-document.ts")
editor.update(() => {
  $writeInlineDocument([], () => "")
  $setSelection(null)
  $insertInlineText(" @")
}, { discrete: true })
assert.deepEqual(editor.getEditorState().read($readInlineDocument), [text(" @")], "未聚焦时也能从工具栏打开引用入口")
editor.update(() => {
  $writeInlineDocument(inline, (key) => byId.get(key).title)
  $getRoot().getFirstChild().getFirstChild().select(1, 1)
  $insertInlineText(" @")
}, { discrete: true })
assert.deepEqual(editor.getEditorState().read($readInlineDocument), [text("对 @照 "), ...inline.slice(1)], "工具栏插入保留光标位置和已有引用")
console.log("PASS inline artifact toolbar insertion with and without a selection")
