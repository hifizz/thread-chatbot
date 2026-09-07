import assert from "node:assert/strict"
import { config } from "dotenv"

config({ path: ".env.local" })
const source = process.env.DIRECT_URL || process.env.DATABASE_URL
assert.ok(source, "测试需要 DIRECT_URL 或 DATABASE_URL")
const testUrl = new URL(source.trim().replace(/^(['"])(.*)\1$/, "$2"))
testUrl.pathname = "/thread-chat-normalized-test"
testUrl.searchParams.set("options", "-c search_path=thread_chat,public,extensions")
process.env.DATABASE_URL = testUrl.toString()
process.env.DIRECT_URL = testUrl.toString()

const [{ eq }, { db }, schema, commands, { DEFAULT_THREAD_CHAT_MODEL_ID: modelId }] = await Promise.all([
  import("drizzle-orm"),
  import("../../lib/db/index.ts"),
  import("../../lib/db/schema.ts"),
  import("../../lib/thread-chat/application/index.ts"),
  import("../../constants/model.ts"),
])
const id = () => crypto.randomUUID()
const userId = `fork-quote-${id()}`
const projectId = id()
const rootThreadId = id()
const turn = (text) => ({ commandId: id(), userMessageId: id(), assistantMessageId: id(), modelId, parts: [{ type: "text", text }] })
const settle = (messageId) => db.update(schema.messages).set({ status: "completed", finishedAt: new Date() }).where(eq(schema.messages.id, messageId))

try {
  await db.insert(schema.user).values({ id: userId, name: "分叉引用测试", email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() })
  const start = { ...turn("测试来源"), projectId, rootThreadId }
  await commands.startProject(userId, start)
  await db.update(schema.messages).set({ parts: [{ type: "text", text: "被划选的原文" }] }).where(eq(schema.messages.id, start.assistantMessageId))
  await settle(start.assistantMessageId)
  const fork = {
    commandId: id(), threadId: id(), sourceMessageId: start.assistantMessageId,
    anchorText: "被划选的原文", anchor: { quote: { exact: "被划选的原文", prefix: "", suffix: "" } }, modelId,
  }
  await commands.forkThread(userId, rootThreadId, fork)
  const first = turn("先分叉后发送")
  const expectedQuote = { type: "data-quote", data: {
    schemaVersion: "thread-quote-v1", text: fork.anchorText,
    source: { type: "message", messageId: fork.sourceMessageId, anchor: fork.anchor },
  } }
  first.parts.unshift({ type: "quote", quote: expectedQuote.data })
  const sent = await commands.sendMessage(userId, fork.threadId, first)
  assert.deepEqual(sent.result.userMessage.parts[0], expectedQuote)
  const reloaded = await commands.getProjectBootstrap(userId, projectId)
  assert.deepEqual(reloaded.messages.find((message) => message.id === first.userMessageId).parts[0], expectedQuote)
  await settle(first.assistantMessageId)
  const edit = { ...turn("修改正文"), parts: [{ type: "quote", quote: expectedQuote.data }, { type: "text", text: "修改正文" }] }
  const edited = await commands.editLatestTurn(userId, first.userMessageId, edit)
  assert.deepEqual(edited.result.generation.userMessage.parts[0], expectedQuote)
  await settle(edit.assistantMessageId)
  await assert.rejects(() => commands.editLatestTurn(userId, edit.userMessageId, {
    ...turn("不能新增引用"), parts: [{ type: "quote", quote: { ...expectedQuote.data, source: { ...expectedQuote.data.source, messageId: id() } } }, { type: "text", text: "不能新增引用" }],
  }))
  const followup = await commands.sendMessage(userId, fork.threadId, turn("第二轮不附加引用"))
  assert.equal(followup.result.userMessage.parts.some((part) => part.type === "data-quote"), false)
  await settle(followup.result.assistantMessage.id)
  const immediate = turn("带首问分叉")
  immediate.parts.unshift({ type: "quote", quote: expectedQuote.data })
  const forked = await commands.forkThread(userId, rootThreadId, {
    ...fork, commandId: id(), threadId: id(),
    firstTurn: { userMessageId: immediate.userMessageId, assistantMessageId: immediate.assistantMessageId, parts: immediate.parts },
  })
  assert.deepEqual(forked.result.generation.userMessage.parts[0], expectedQuote)
  await settle(immediate.assistantMessageId)
  const removed = await commands.editLatestTurn(userId, immediate.userMessageId, turn("显式删除引用"))
  assert.equal(removed.result.generation.userMessage.parts.some((part) => part.type === "data-quote"), false)
  console.log("PASS 分叉引用数据库回归：两条入口、读取恢复、编辑保留、拒绝伪造、后续追问与显式删除")
} finally {
  await db.delete(schema.user).where(eq(schema.user.id, userId))
  await globalThis.__dbClient?.end()
}
