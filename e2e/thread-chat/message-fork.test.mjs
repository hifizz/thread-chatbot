import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { forkThreadCommandSchema } from "../../lib/thread-chat/contracts/commands.ts"
import { buildFrozenForkContext } from "../../lib/thread-chat/domain/fork-context.ts"
import { parseThreadTreeState } from "../../lib/thread-chat/domain/message-graph.ts"
import { buildThreadChatSystem } from "../../lib/chat/thread-chat-prompt.ts"
import { createConversationStore } from "../../app/thread-chat/core/store.ts"
import { projectConversationTree } from "../../app/thread-chat/core/projections.ts"
import { createConversationCommands } from "../../app/thread-chat/net/commands/conversation-commands.ts"
import { createGate3MockRuntime } from "../../app/thread-chat/gate-3-harness/mock-v1-runtime.ts"
import { MessageForkActions } from "../../app/thread-chat/branching/message-fork-actions.tsx"

const id = () => crypto.randomUUID()
const bareCommand = {
  commandId: id(), threadId: id(), sourceMessageId: id(), modelId: "test/model",
}
assert.equal(forkThreadCommandSchema.safeParse(bareCommand).success, true)
assert.equal(forkThreadCommandSchema.safeParse({ ...bareCommand, anchor: null, anchorText: null }).success, true)
const anchor = { quote: { exact: "选区", prefix: "", suffix: "" } }
assert.equal(forkThreadCommandSchema.safeParse({ ...bareCommand, anchor, anchorText: "选区" }).success, true)
for (const fields of [{ anchor }, { anchorText: "选区" }, { anchor, anchorText: null }, { anchorText: "" }]) {
  assert.equal(forkThreadCommandSchema.safeParse({ ...bareCommand, ...fields }).success, false)
}

const rows = [
  { id: "u1", sequence: 1 }, { id: "a1", sequence: 2 },
  { id: "old", sequence: 3, supersededAt: "2026-09-01" },
  { id: "u2", sequence: 4 }, { id: "a2", sequence: 5 },
].map((row) => ({ supersededAt: null, ...row }))
assert.deepEqual(buildFrozenForkContext({ parentForkContext: ["ancestor"], parentMessages: rows, sourceMessageId: "a1" }), ["ancestor", "u1", "a1"])
assert.throws(() => buildFrozenForkContext({ parentForkContext: [], parentMessages: rows, sourceMessageId: "old" }))
assert.equal(buildThreadChatSystem(null), buildThreadChatSystem())
assert.notEqual(buildThreadChatSystem("选区"), buildThreadChatSystem(null))

const mock = createGate3MockRuntime(id())
const store = createConversationStore({ bootstrap: mock.bootstrap })
const parent = mock.bootstrap.threads.find((thread) => thread.parentId === null)
const source = mock.bootstrap.messages.find((message) => message.threadId === parent.id && message.role === "assistant")
let requests = 0
const commands = createConversationCommands({
  store,
  client: {
    ...mock.client,
    async forkThread(threadId, command) {
      requests++
      assert.equal(command.anchor, undefined)
      assert.equal(command.anchorText, undefined)
      assert.equal(command.firstTurn, undefined)
      forkThreadCommandSchema.parse(command)
      return mock.client.forkThread(threadId, command)
    },
  },
  fetch: async () => { throw new Error("空分叉不得启动模型流") },
})
const before = Object.keys(store.getState().messagesById).length
const result = await commands.forkThread({ parentThreadId: parent.id, sourceMessageId: source.id, modelId: parent.modelId })
assert.equal(requests, 1)
assert.equal(result.connection, null)
assert.equal(result.response.data.generation, null)
const child = result.response.data.thread
assert.equal(child.anchorText, null)
assert.equal(child.forkAnchor, null)
assert.equal(child.forkMessageId, source.id)
assert.equal(child.forkContext.at(-1), source.id)
assert.equal(Object.keys(store.getState().messagesById).length, before)

// 重新读取服务端快照后，仍可从来源消息回访无选区分支。
const reloaded = createConversationStore({ bootstrap: await mock.client.getProject(mock.bootstrap.project.id) })
const tree = projectConversationTree(reloaded.getState())
assert.doesNotThrow(() => parseThreadTreeState(tree))
assert.equal(tree.threads[child.id].title, "新分支")
const viewMessage = tree.threads.main.messages.find((message) => message.id === source.id)
const render = (message) => renderToStaticMarkup(React.createElement(MessageForkActions, {
  state: tree, message, onFork: async () => {}, onOpenThread: () => {},
}))
const html = render(viewMessage)
assert.match(html, /开启分叉聊天/)
assert.match(html, /新分支/)
assert.doesNotMatch(html, /<q>/)
for (const status of ["pending", "streaming", "stopped", "error"]) {
  assert.equal(render({ ...viewMessage, status }), "")
}
assert.equal(render({ ...viewMessage, role: "user" }), "")
assert.match(render({ ...viewMessage, text: "", uiParts: [], artifactIds: ["artifact"] }), /开启分叉聊天/)

console.log("PASS 消息无引用分叉：契约、历史截止、空创建、刷新恢复和消息入口")
