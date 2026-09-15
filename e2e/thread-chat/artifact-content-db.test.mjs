import assert from "node:assert/strict"
import { config } from "dotenv"

config({ path: ".env.local" })
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/(wt_|thread-chat-.*test)/, "仅允许独立测试数据库")

// ESM 静态 import 先于 config() 求值，db 客户端会拿到旧环境——必须动态 import。
const [
  { eq, inArray },
  { db },
  schema,
  commands,
  { finalizeGeneration },
  { artifactIdForTool },
  { DEFAULT_THREAD_CHAT_MODEL_ID: modelId },
] = await Promise.all([
  import("drizzle-orm"),
  import("../../lib/db/index.ts"),
  import("../../lib/db/schema.ts"),
  import("../../lib/thread-chat/application/index.ts"),
  import("../../lib/thread-chat/streaming/finalize.ts"),
  import("../../lib/thread-chat/domain/tool-identity.ts"),
  import("../../constants/model.ts"),
])
const id = () => crypto.randomUUID()
const userId = `artifact-test-${id()}`
const otherUser = `artifact-other-${id()}`
const turn = (text = "问题") => ({ commandId: id(), userMessageId: id(), assistantMessageId: id(), modelId, parts: [{ type: "text", text }] })
const settle = (messageId) => db.update(schema.messages).set({ status: "completed", finishedAt: new Date() }).where(eq(schema.messages.id, messageId))
const source = { ...turn(), projectId: id(), rootThreadId: id() }
const cleanupProjectIds = [source.projectId]
async function rejected(command, user = userId) {
  await assert.rejects(() => commands.sendMessage(user, source.rootThreadId, command))
  assert.equal((await db.select().from(schema.messages).where(eq(schema.messages.id, command.userMessageId))).length, 0)
}
try {
  for (const user of [userId, otherUser]) await db.insert(schema.user).values({ id: user, name: "引用测试", email: `${user}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() })
  await commands.startProject(userId, source)
  const artifactId = artifactIdForTool(source.assistantMessageId, "artifact-call")
  const snapshot = { id: source.assistantMessageId, role: "assistant", parts: [{ type: "tool-createMarkdownArtifact", toolCallId: "artifact-call", state: "output-available", input: { title: "原产物", content: "固定正文" }, output: { created: true, artifactId } }] }
  await finalizeGeneration({ messageId: source.assistantMessageId, status: "completed", snapshot })
  await finalizeGeneration({ messageId: source.assistantMessageId, status: "completed", snapshot: { ...snapshot, parts: [{ ...snapshot.parts[0], input: { title: "错误覆盖", content: "不应覆盖" } }] } })
  assert.equal((await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, artifactId)))[0].content, "固定正文")
  const reference = { type: "artifact-reference", artifactId }
  await rejected({ ...turn(), parts: [{ type: "text", text: "问题" }, { ...reference, artifactId: id() }] })
  await rejected({ ...turn(), parts: [{ type: "text", text: "问题" }, { ...reference, title: "伪造" }] })
  await rejected({ ...turn(), parts: [{ type: "text", text: "问题" }, reference] }, otherUser)
  const foreign = { ...turn(), projectId: id(), rootThreadId: id() }
  cleanupProjectIds.push(foreign.projectId)
  await commands.startProject(userId, foreign)
  await settle(foreign.assistantMessageId)
  const otherId = id()
  await db.insert(schema.artifacts).values({ id: otherId, projectId: foreign.projectId, threadId: foreign.rootThreadId, sourceMessageId: foreign.assistantMessageId, kind: "markdown", title: "其他项目", content: "不能引用" })
  await rejected({ ...turn(), parts: [{ type: "text", text: "问题" }, { ...reference, artifactId: otherId }] })
  await db.update(schema.messages).set({ status: "stopped" }).where(eq(schema.messages.id, source.assistantMessageId))
  await rejected({ ...turn(), parts: [{ type: "text", text: "问题" }, reference] })
  await settle(source.assistantMessageId)
  await rejected({ ...turn(), parts: [{ type: "text", text: "问题" }, ...Array(21).fill(reference)] })
  // 唯一正文预算：边界允许、重复不重复计费，多产物合计超限拒绝。
  const largeId = id(), excessId = id()
  await db.insert(schema.artifacts).values([
    { id: largeId, projectId: source.projectId, threadId: source.rootThreadId, sourceMessageId: source.assistantMessageId, kind: "markdown", title: "界", content: "文".repeat(199999) },
    { id: excessId, projectId: source.projectId, threadId: source.rootThreadId, sourceMessageId: source.assistantMessageId, kind: "markdown", title: "多", content: "一" },
  ])
  const largeRef = { type: "artifact-reference", artifactId: largeId }
  await rejected({ ...turn(), parts: [{ type: "text", text: "超预算" }, largeRef, { type: "artifact-reference", artifactId: excessId }] })
  const boundary = { ...turn(), parts: [{ type: "text", text: "预算边界" }, largeRef, largeRef] }
  await commands.sendMessage(userId, source.rootThreadId, boundary)
  await settle(boundary.assistantMessageId)
  const fork = await commands.forkThread(userId, source.rootThreadId, {
    commandId: id(), threadId: id(), sourceMessageId: source.assistantMessageId,
    target: { type: "message", anchor: { quote: { exact: "固定正文", prefix: "", suffix: "" } } }, modelId,
    firstTurn: { userMessageId: id(), assistantMessageId: id(), parts: [{ type: "text", text: "从子分支引用" }, reference] },
  })
  assert.equal(fork.result.generation.userMessage.parts[1].data.artifactId, artifactId)
  await settle(fork.result.generation.assistantMessage.id)
  const bootstrap = await commands.getProjectBootstrap(userId, source.projectId)
  assert.equal(bootstrap.messages.find(message => message.id === fork.result.generation.userMessage.id).parts[1].data.artifactId, artifactId)
  const own = { ...turn(), parts: [{ type: "text", text: "前文 " }, reference, { type: "text", text: " 后文" }, reference] }
  const saved = (await commands.sendMessage(userId, source.rootThreadId, own)).result
  // 共享文档特性：同 Project 的新文档修订会以 notices part 追加在末尾。
  assert.deepEqual(saved.userMessage.parts.map((part) => part.type), ["text", "data-artifact-reference", "text", "data-artifact-reference", "data-document-update-notices"])
  const replay = (await commands.sendMessage(userId, source.rootThreadId, own)).result
  assert.equal(replay.userMessage.id, saved.userMessage.id)
  await settle(own.assistantMessageId)
  // 保留旧引用不要求重新选择当前 completed 来源，且固定 ID 不变。
  await db.update(schema.messages).set({ status: "stopped" }).where(eq(schema.messages.id, source.assistantMessageId))
  const edited = (await commands.editLatestTurn(userId, own.userMessageId, { ...turn(), parts: own.parts })).result.generation
  assert.equal(edited.userMessage.parts[1].data.artifactId, artifactId)
  await settle(edited.assistantMessage.id)
  // 旧 Quote 原快照可保留、可删除；不能新增、复制或改写。
  const legacy = { type: "data-quote", data: { text: "旧引用原文" } }
  await db.update(schema.messages).set({ parts: [legacy, { type: "text", text: "原问题" }] }).where(eq(schema.messages.id, edited.userMessage.id))
  const legacyInput = { type: "quote", quote: legacy.data }
  for (const quotes of [[legacyInput, legacyInput], [{ type: "quote", quote: { text: "改写" } }]]) {
    await assert.rejects(() => commands.editLatestTurn(userId, edited.userMessage.id, { ...turn(), parts: [...quotes, { type: "text", text: "编辑" }] }))
  }
  const kept = (await commands.editLatestTurn(userId, edited.userMessage.id, { ...turn(), parts: [legacyInput, { type: "text", text: "编辑后" }] })).result.generation
  assert.deepEqual(kept.userMessage.parts[0], legacy)
  await settle(kept.assistantMessage.id)
  const removed = (await commands.editLatestTurn(userId, kept.userMessage.id, turn("删除引用"))).result.generation
  assert.deepEqual(removed.userMessage.parts.slice(0, 1), [{ type: "text", text: "删除引用" }])
  assert.equal(removed.userMessage.parts.at(-1).type, "data-document-update-notices")
  await settle(removed.assistantMessage.id)
  await rejected({ ...turn(), parts: [legacyInput, { type: "text", text: "新消息不可携带旧引用" }] })
  const startBad = { ...turn(), projectId: id(), rootThreadId: id(), parts: [{ type: "text", text: "跨项目" }, reference] }
  await assert.rejects(() => commands.startProject(userId, startBad))
  assert.equal((await db.select().from(schema.projects).where(eq(schema.projects.id, startBad.projectId))).length, 0)
  console.log("PASS 数据库事务：权限/范围/完成状态/预算拒绝无半消息、原子终态不可覆盖、完整编辑、旧 Quote 校验与删除、幂等重试")
} finally {
  // document_revisions.actorUserId 不级联；documents 级联删除其 revisions。
  await db.delete(schema.documents).where(inArray(schema.documents.projectId, cleanupProjectIds))
  await db.delete(schema.user).where(eq(schema.user.id, userId))
  await db.delete(schema.user).where(eq(schema.user.id, otherUser))
  await globalThis.__dbClient?.end()
}
