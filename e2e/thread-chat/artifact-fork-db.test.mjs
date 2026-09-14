import assert from "node:assert/strict"
import { eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import * as schema from "../../lib/db/schema.ts"
import * as commands from "../../lib/thread-chat/application/index.ts"
import { compileModelContext } from "../../lib/thread-chat/application/compile-model-context.ts"
import { artifactIdForTool } from "../../lib/thread-chat/streaming/artifacts.ts"
import { DEFAULT_THREAD_CHAT_MODEL_ID as modelId } from "../../constants/model.ts"

assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/(wt_|thread-chat-.*test)/, "仅允许独立测试数据库")
const id = () => crypto.randomUUID()
const userId = `artifact-fork-${id()}`
const turn = (text) => ({ commandId: id(), userMessageId: id(), assistantMessageId: id(), modelId, parts: [{ type: "text", text }] })
const source = { ...turn("生成评测文档"), projectId: id(), rootThreadId: id() }
const content = "# 金融评测\n\n采用 AI Judge 评分。\n\n准备 500 道题。\n\n唯一全文标记：蓝鲸143"
const title = "评测文档"
const artifactId = artifactIdForTool(source.assistantMessageId, "artifact-call")
const anchor = { quote: { exact: "采用 AI Judge 评分。", prefix: "", suffix: "" } }
const tool = { type: "tool-createMarkdownArtifact", toolCallId: "artifact-call", state: "output-available", input: { title, content }, output: { created: true, artifactId } }
const settle = (messageId, parts = [{ type: "text", text: "后代讨论来源" }]) => db.update(schema.messages).set({ status: "completed", finishedAt: new Date(), parts }).where(eq(schema.messages.id, messageId))
const context = (threadId) => compileModelContext({ userId, threadId, modelId })
const assertBody = (model, count = 1) => {
  const wire = JSON.stringify(model)
  assert.equal(wire.split("唯一全文标记：蓝鲸143").length - 1, count)
  assert.ok(wire.includes(title))
  return wire
}
try {
  await db.insert(schema.user).values({ id: userId, name: "Artifact fork 验收", email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() })
  await commands.startProject(userId, source)
  await settle(source.assistantMessageId, [tool])
  await db.insert(schema.artifacts).values({ id: artifactId, projectId: source.projectId, threadId: source.rootThreadId, sourceMessageId: source.assistantMessageId, kind: "markdown", title, content })
  const forkInput = { commandId: id(), threadId: id(), sourceMessageId: source.assistantMessageId, target: { type: "artifact", artifactId, anchor }, modelId }
  const child = (await commands.forkThread(userId, source.rootThreadId, forkInput)).result
  assert.equal(child.generation, null)
  assert.equal(child.thread.parentId, source.rootThreadId)
  assert.equal(child.thread.forkMessageId, source.assistantMessageId)
  assert.equal(child.thread.forkArtifactId, artifactId)
  assert.deepEqual(child.thread.forkAnchor, anchor)
  assert.equal(child.thread.anchorText, anchor.quote.exact)
  assert.ok(child.thread.forkContext.includes(source.assistantMessageId))
  assert.equal((await commands.getProjectBootstrap(userId, source.projectId)).messages.filter(m => m.threadId === child.thread.id).length, 0)
  assertBody(await context(child.thread.id))
  const sent = (await commands.sendMessage(userId, child.thread.id, turn("删除 Quote 后发送"))).result
  assert.equal(sent.userMessage.parts.some(p => p.type === "data-quote"), false)
  await settle(sent.assistantMessage.id)
  assert.ok(!assertBody(await context(child.thread.id)).includes("<quote>"))
  let parent = child.thread.id
  let messageId = sent.assistantMessage.id
  for (let depth = 0; depth < 2; depth++) {
    const next = (await commands.forkThread(userId, parent, { commandId: id(), threadId: id(), sourceMessageId: messageId, modelId, target: { type: "message", anchor: { quote: { exact: "后代讨论来源", prefix: "", suffix: "" } } } })).result
    assertBody(await context(next.thread.id))
    const response = (await commands.sendMessage(userId, next.thread.id, turn("继续讨论"))).result
    await settle(response.assistantMessage.id)
    parent = next.thread.id
    messageId = response.assistantMessage.id
  }
  // 工具不可用或身份/正文不完整时，验证经过真正 SDK 转换后的数据库正文补全。
  for (const variant of [[], [{ ...tool, input: { title } }], [{ ...tool, input: undefined }], [{ ...tool, state: "input-available", output: undefined }], [{ ...tool, preliminary: true }], [{ ...tool, output: { created: true, artifactId: id() }, input: { title, content: "缩略" } }], [{ ...tool, input: { title: "错误标题", content: "缩略" } }], [{ ...tool, input: { title, content: "缩略" } }]]) {
    await settle(source.assistantMessageId, variant)
    assertBody(await context(parent))
  }
  await settle(source.assistantMessageId, [tool])
  const first = turn("带 Quote 的首问")
  first.parts.unshift({ type: "quote", quote: { schemaVersion: "thread-quote-v1", text: anchor.quote.exact, source: { type: "artifact", artifactId, messageId: source.assistantMessageId, anchor } } })
  const immediate = (await commands.forkThread(userId, source.rootThreadId, { ...forkInput, commandId: id(), threadId: id(), firstTurn: { userMessageId: first.userMessageId, assistantMessageId: first.assistantMessageId, parts: first.parts } })).result
  assert.equal(immediate.generation.userMessage.parts[0].data.source.artifactId, artifactId)
  await settle(first.assistantMessageId)
  assert.ok(assertBody(await context(immediate.thread.id)).includes("<quote>"))
  await assert.rejects(() => commands.forkThread(userId, child.thread.id, { ...forkInput, commandId: id(), threadId: id() }))
  console.log("PASS Artifact fork 数据关系、留空无生成、首问 Quote、删除不恢复、SDK 全文补全与去重、两代继承、错误父节点拒绝")
} finally {
  await db.delete(schema.user).where(eq(schema.user.id, userId))
  await globalThis.__dbClient?.end()
}
