import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { buildUserParts, userMessageQuoteText } from "../../lib/thread-chat/domain/user-message-parts.ts"
import { persistentMessageParts } from "../../lib/thread-chat/persistence/message-parts.ts"
import { createConversationStore } from "../../app/thread-chat/core/store.ts"
import { projectMessageDTO } from "../../app/thread-chat/core/projections.ts"
import { createConversationCommands } from "../../app/thread-chat/net/commands/conversation-commands.ts"
import { createGate3MockRuntime } from "../../app/thread-chat/gate-3-harness/mock-v1-runtime.ts"
import { EditableUserMessage } from "../../app/thread-chat/chat/message/editable-user-message.tsx"

const id = () => crypto.randomUUID()
const quote = "被划选的原文\n第二行"
const files = [{ url: "/api/attachments/file", mediaType: "text/plain", filename: "说明.txt" }]
const parts = buildUserParts("解释一下", files, quote)
assert.deepEqual(parts, [
  { type: "data-quote", data: { text: quote } },
  { type: "text", text: "解释一下" },
  { type: "file", ...files[0] },
])
const restored = JSON.parse(JSON.stringify(persistentMessageParts(parts)))
assert.deepEqual(restored, parts)
assert.equal(userMessageQuoteText(restored), quote)
assert.equal(userMessageQuoteText(buildUserParts("新问题", [], null)), undefined)
assert.equal(userMessageQuoteText(buildUserParts("修改正文", [], userMessageQuoteText(parts))), quote)

const seed = createGate3MockRuntime(id()).bootstrap
const root = seed.threads.find((thread) => thread.parentId === null)
const source = seed.messages.find((message) => message.threadId === root.id && message.role === "assistant")
const child = {
  ...root, id: id(), parentId: root.id, depth: 1, footnote: 4,
  forkMessageId: source.id, forkContext: [source.id], anchorText: quote,
  forkAnchor: { quote: { exact: quote, prefix: "", suffix: "" } },
}
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
        const messageId = command.firstTurn?.userMessageId ?? command.userMessageId
        const message = store.getState().messagesById[messageId]
        assert.ok(message)
        assert.equal(userMessageQuoteText(message.parts), expectedQuote)
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
  id: id(), threadId: child.id, sequence: 1, parts: buildUserParts("首问", [], quote),
}
const populatedSeed = { ...emptyBranchSeed, messages: [...seed.messages, firstUser] }
await inspectOptimistic(populatedSeed, "sendMessage", (commands) => commands.sendMessage({
  threadId: child.id, modelId: child.modelId, text: "后续追问",
}), undefined)
await inspectOptimistic(populatedSeed, "editMessage", (commands) => commands.editLatestTurn({
  userMessageId: firstUser.id, modelId: child.modelId, text: "改写首问",
}), quote)
await inspectOptimistic({ ...populatedSeed, messages: populatedSeed.messages.map((message) =>
  message.id === firstUser.id ? { ...message, parts: buildUserParts("无引用的首问", []) } : message) },
"editMessage", (commands) => commands.editLatestTurn({
  userMessageId: firstUser.id, modelId: child.modelId, text: "仍然不带引用",
}), undefined)

console.log("PASS 划选分叉首问引用：内容持久化、两种创建入口、背景引用块、编辑保留及无引用分支")
