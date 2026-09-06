import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { buildForkUserParts, buildEditedUserParts, editUserMessageContent } from "../../lib/thread-chat/domain/user-message-parts.ts"
import { messageContentToUiParts } from "../../lib/thread-chat/contracts/message-content.ts"
import { assertEditQuoteSemantics } from "../../lib/thread-chat/application/quote-validation.ts"
import { sendMessageCommandSchema, editLatestTurnCommandSchema, forkThreadCommandSchema } from "../../lib/thread-chat/contracts/commands.ts"
import { threadQuotePartV1Schema } from "../../lib/thread-chat/contracts/quote.ts"
const userMessageQuoteText = (parts) => parts.find((part) => part.type === "data-quote")?.data.text
const content = (text, files = []) => ({ parts: [{ type: "text", text }, ...files.map((file) => ({ type: "file", file }))] })
import { persistentMessageParts } from "../../lib/thread-chat/persistence/message-parts.ts"
import { createConversationStore } from "../../app/thread-chat/core/store.ts"
import { projectMessageDTO } from "../../app/thread-chat/core/projections.ts"
import { createConversationCommands } from "../../app/thread-chat/net/commands/conversation-commands.ts"
import { createGate3MockRuntime } from "../../app/thread-chat/gate-3-harness/mock-v1-runtime.ts"
import { EditableUserMessage } from "../../app/thread-chat/chat/message/editable-user-message.tsx"

const id = () => crypto.randomUUID()
const quote = "被划选的原文\n第二行"
const files = [{ url: "/api/attachments/file", mediaType: "text/plain", filename: "说明.txt" }]
const seed = createGate3MockRuntime(id()).bootstrap
const root = seed.threads.find((thread) => thread.parentId === null)
const source = seed.messages.find((message) => message.threadId === root.id && message.role === "assistant")
const child = {
  ...root, id: id(), parentId: root.id, depth: 1, footnote: 4,
  forkMessageId: source.id, forkContext: [source.id], anchorText: quote,
  forkAnchor: { quote: { exact: quote, prefix: "", suffix: "" } },
}
const parts = buildForkUserParts(content("解释一下", files), child, 1)
assert.equal(threadQuotePartV1Schema.safeParse(parts[0]).success, true)
assert.deepEqual(parts.slice(1), messageContentToUiParts(content("解释一下", files)))
const restored = JSON.parse(JSON.stringify(persistentMessageParts(parts)))
assert.deepEqual(restored, parts)
assert.equal(userMessageQuoteText(restored), quote)
assert.equal(userMessageQuoteText(buildForkUserParts(content("追问"), child, 3)), undefined)
assert.equal(userMessageQuoteText(buildForkUserParts(content("根消息"), root, 1)), undefined)
const explicit = { parts: [{ type: "text", text: "问题" }, { type: "quote", quote: { ...parts[0].data, comment: "保留批注" } }] }
assert.deepEqual(buildForkUserParts(explicit, child, 1), messageContentToUiParts(explicit))
const edited = editUserMessageContent(messageContentToUiParts(explicit), "修改", files)
assert.deepEqual(edited.parts.map((part) => part.type), ["text", "quote", "file"])
assert.equal(edited.parts[1].quote.comment, "保留批注")
assert.doesNotThrow(() => assertEditQuoteSemantics(parts, edited))
assert.throws(() => assertEditQuoteSemantics([], edited))
assert.throws(() => assertEditQuoteSemantics(parts, { parts: [edited.parts[1], edited.parts[1]] }))
assert.throws(() => assertEditQuoteSemantics(parts, { parts: [{ type: "quote", quote: { ...parts[0].data, source: { ...parts[0].data.source, messageId: id() } } }] }))
assert.doesNotThrow(() => assertEditQuoteSemantics(parts, content("显式移除引用")))
assert.equal(userMessageQuoteText(buildEditedUserParts(content("显式移除引用"), parts)), undefined)
const legacy = [{ type: "data-quote", data: { text: quote } }, ...messageContentToUiParts(content("旧消息"))]
assert.equal(userMessageQuoteText(buildEditedUserParts(editUserMessageContent(legacy, "修改旧消息", []), legacy)), quote)

const emptyBranchSeed = { ...seed, threads: [...seed.threads, child] }

// 截在请求边界，检查真实客户端命令的即时消息与失败回滚；不调用模型。
async function inspectOptimistic(bootstrap, method, invoke, expectedQuote) {
  const store = createConversationStore({ bootstrap })
  const before = structuredClone(store.getState().messagesById)
  const failure = new Error("受控请求失败")
  let calls = 0
  const commands = createConversationCommands({
    store, networkAttempts: 1,
    client: {
      async [method](_scopeId, command) {
        calls++
        const schema = method === "forkThread" ? forkThreadCommandSchema : method === "editMessage" ? editLatestTurnCommandSchema : sendMessageCommandSchema
        assert.equal(schema.safeParse(command).success, true)
        const messageId = command.firstTurn?.userMessageId ?? command.userMessageId
        const message = store.getState().messagesById[messageId]
        assert.ok(message)
        assert.equal(userMessageQuoteText(message.parts), expectedQuote)
        const serverParts = method === "forkThread"
          ? buildForkUserParts(command.firstTurn, child, 1)
          : method === "editMessage"
            ? buildEditedUserParts(command, before[_scopeId].parts)
            : buildForkUserParts(command, bootstrap.threads.find((thread) => thread.id === _scopeId), message.sequence)
        assert.deepEqual(message.parts, serverParts)
        const view = projectMessageDTO({ message, state: store.getState(), parentMessageId: null })
        const html = renderToStaticMarkup(React.createElement(EditableUserMessage, {
          threadId: message.threadId, message: view, editable: true, commands: {},
        }))
        if (expectedQuote) {
          assert.match(html, /class="msg-quote"/)
          assert.ok(html.includes(expectedQuote))
        } else {
          assert.doesNotMatch(html, /class="msg-quote"/)
        }
        throw failure
      },
    },
  })
  await assert.rejects(() => invoke(commands), (error) => error === failure)
  assert.equal(calls, 1)
  assert.deepEqual(store.getState().messagesById, before)
}

await inspectOptimistic(seed, "forkThread", (commands) => commands.forkThread({
  parentThreadId: root.id, sourceMessageId: source.id, modelId: root.modelId,
  anchorText: quote, anchor: child.forkAnchor, text: "解释这段话",
}), quote)
await inspectOptimistic(emptyBranchSeed, "sendMessage", (commands) => commands.sendMessage({
  threadId: child.id, modelId: child.modelId, text: "先分叉再提问",
}), quote)
const unquotedSeed = { ...emptyBranchSeed, threads: emptyBranchSeed.threads.map((thread) =>
  thread.id === child.id ? { ...thread, anchorText: null, forkAnchor: null } : thread) }
await inspectOptimistic(unquotedSeed, "sendMessage", (commands) => commands.sendMessage({
  threadId: child.id, modelId: child.modelId, text: "直接从消息分叉",
}), undefined)
const firstUser = {
  ...seed.messages.find((message) => message.role === "user"),
  id: id(), threadId: child.id, sequence: 1, parts: buildForkUserParts(content("首问"), child, 1),
}
const populatedSeed = { ...emptyBranchSeed, messages: [...seed.messages, firstUser] }
await inspectOptimistic(populatedSeed, "sendMessage", (commands) => commands.sendMessage({
  threadId: child.id, modelId: child.modelId, text: "后续追问",
}), undefined)
await inspectOptimistic(populatedSeed, "editMessage", (commands) => commands.editLatestTurn({
  userMessageId: firstUser.id, modelId: child.modelId, text: "改写首问",
}), quote)
await inspectOptimistic({ ...populatedSeed, messages: populatedSeed.messages.map((message) =>
  message.id === firstUser.id ? { ...message, parts: messageContentToUiParts(content("无引用的首问")) } : message) },
"editMessage", (commands) => commands.editLatestTurn({
  userMessageId: firstUser.id, modelId: child.modelId, text: "仍然不带引用",
}), undefined)

await inspectOptimistic({ ...populatedSeed, messages: populatedSeed.messages.map((message) =>
  message.id === firstUser.id ? { ...message, parts: legacy } : message) },
"editMessage", (commands) => commands.editLatestTurn({
  userMessageId: firstUser.id, modelId: child.modelId, text: "旧版引用也保留",
}), quote)

console.log("PASS 划选分叉首问引用：内容持久化、两种创建入口、背景引用块、编辑保留及无引用分支")
