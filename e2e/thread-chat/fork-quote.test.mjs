import assert from "node:assert/strict"
import { createConversationStore } from "../../app/thread-chat/core/store.ts"
import { createConversationCommands } from "../../app/thread-chat/net/commands/conversation-commands.ts"
import { forkFirstTurnContent, messageContentToUiParts, messagePartsToContent } from "../../lib/thread-chat/contracts/message-content.ts"
import { assertEditQuoteSemantics } from "../../lib/thread-chat/application/quote-validation.ts"
const id = () => crypto.randomUUID()
const projectId = id(), rootId = id(), sourceId = id(), userId = id()
const anchor = { quote: { exact: "被划选的原文", prefix: "", suffix: "" } }
const firstTurn = forkFirstTurnContent({ text: "解释原文", sourceMessageId: sourceId, anchorText: anchor.quote.exact, anchor })
const quotePart = messageContentToUiParts(firstTurn)[0]
const legacy = { type: "data-quote", data: { text: "旧引用" } }
const ordered = [{ type: "text", text: "前文 " }, quotePart, { type: "file", url: "/api/attachments/test", mediaType: "text/plain" }, legacy, { type: "text", text: " 后文" }]
assert.deepEqual(messageContentToUiParts(messagePartsToContent(ordered)), ordered)
assert.doesNotThrow(() => assertEditQuoteSemantics(ordered, messagePartsToContent(ordered)))
assert.doesNotThrow(() => assertEditQuoteSemantics(ordered, { parts: [{ type: "text", text: "删除全部胶囊" }] }))
for (const parts of [
  [legacy, quotePart], [quotePart, quotePart], [{ type: "data-quote", data: { text: "修改旧正文" } }],
]) assert.throws(() => assertEditQuoteSemantics(ordered, { parts: parts.map((part) => ({ type: "quote", quote: part.data })) }))
const now = new Date().toISOString()
const root = { id: rootId, projectId, parentId: null, depth: 0, modelId: "test/model", titleGenerationAttempted: true }
const source = { id: sourceId, projectId, threadId: rootId, sequence: 2, role: "assistant", status: "completed", parts: [], supersededAt: null }
const original = { id: userId, projectId, threadId: rootId, sequence: 1, role: "user", status: "completed", parts: ordered, supersededAt: null }
const bootstrap = { project: { id: projectId, rootThreadId: rootId }, threads: [root], messages: [original, source], artifacts: [], files: [], activeGenerationIds: [] }
async function capture(method, invoke) {
  const store = createConversationStore({ bootstrap })
  let captured
  const commands = createConversationCommands({ store, client: { [method]: async (_id, command) => { captured = command; throw new Error("captured") } } })
  await assert.rejects(() => invoke(commands), /captured/)
  commands.dispose()
  return captured
}
const forkInput = { parentThreadId: rootId, sourceMessageId: sourceId, anchorText: anchor.quote.exact, anchor, modelId: "test/model" }
const fork = await capture("forkThread", (commands) => commands.forkThread({ ...forkInput, firstTurn }))
assert.deepEqual(fork.firstTurn.parts, firstTurn.parts, "结构化 firstTurn 不依赖独立 text 字段，不重复补入 Quote")
const empty = await capture("forkThread", (commands) => commands.forkThread(forkInput))
assert.equal(empty.firstTurn, undefined)
const invalid = createConversationCommands({ store: createConversationStore({ bootstrap }), client: {} })
await assert.rejects(() => invalid.forkThread({ ...forkInput, firstTurn: { parts: [] } }))
invalid.dispose()
const edit = await capture("editMessage", (commands) => commands.editLatestTurn({ userMessageId: userId, assistantMessageId: sourceId, modelId: "test/model", content: messagePartsToContent(ordered) }))
assert.deepEqual(messageContentToUiParts(edit), ordered)
const send = await capture("sendMessage", (commands) => commands.sendMessage({ threadId: rootId, modelId: "test/model", content: firstTurn }))
assert.deepEqual(send.parts, firstTurn.parts)
console.log("PASS 完整内容命令：分叉首问/空分叉/非法首问、完整编辑、旧 Quote 往返与原快照校验")
