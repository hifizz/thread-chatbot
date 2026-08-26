import assert from "node:assert/strict"
import { config } from "dotenv"

config({ path: ".env.local" })
const source = process.env.DIRECT_URL || process.env.DATABASE_URL
assert.ok(source, "测试需要 DIRECT_URL 或 DATABASE_URL")
const testUrl = new URL(source.trim().replace(/^(['"])(.*)\1$/, "$2"))
testUrl.pathname = "/thread-chat-normalized-test"
testUrl.searchParams.set(
  "options",
  "-c search_path=thread_chat,public,extensions"
)
process.env.DATABASE_URL = testUrl.toString()
process.env.DIRECT_URL = testUrl.toString()

const [drizzle, { db }, schema, application, streaming, constants] =
  await Promise.all([
    import("drizzle-orm"),
    import("../../lib/db/index.ts"),
    import("../../lib/db/schema.ts"),
    import("../../lib/thread-chat/application/index.ts"),
    import("../../lib/thread-chat/streaming/index.ts"),
    import("../../constants/model.ts"),
  ])
const { and, eq } = drizzle
const id = () => crypto.randomUUID()
const prefix = `gate2-${id()}`
const userId = `${prefix}-owner`
const otherUserId = `${prefix}-other`
const modelId = constants.DEFAULT_THREAD_CHAT_MODEL_ID

function textStream(parts) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

function terminalSnapshot(messageId, threadId, text = "terminal") {
  return {
    id: messageId,
    role: "assistant",
    metadata: { messageId, threadId, modelId },
    parts: [{ type: "text", text, state: "done" }],
  }
}

async function createUser(idValue, suffix) {
  await db.insert(schema.user).values({
    id: idValue,
    name: `Gate 2 ${suffix}`,
    email: `${prefix}-${suffix}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function send(threadId, text) {
  return application.sendMessage(userId, threadId, {
    commandId: id(),
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text,
    files: [],
  })
}

try {
  await createUser(userId, "owner")
  await createUser(otherUserId, "other")
  const projectId = id()
  const rootThreadId = id()
  const start = await application.startProject(userId, {
    commandId: id(),
    projectId,
    rootThreadId,
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "创建一份 Markdown 文档",
    files: [],
  })
  const assistantId = start.result.assistantMessage.id
  const store = new streaming.SessionStore({ startCleanupTimer: false })
  let prepareCount = 0
  const started = store.start({
    messageId: assistantId,
    initialSnapshot: streaming.initialAssistantSnapshot({
      messageId: assistantId,
      threadId: rootThreadId,
      modelId,
    }),
    run: (session) =>
      streaming.runGeneration({
        userId,
        messageId: assistantId,
        session,
        dependencies: {
          prepare: async () => {
            prepareCount += 1
            return {
              textStream: textStream([
                { type: "start" },
                {
                  type: "tool-call",
                  toolCallId: "markdown-call",
                  toolName: "createMarkdownArtifact",
                  input: { title: "Gate 2 文档", content: "# 内容" },
                },
                {
                  type: "tool-result",
                  toolCallId: "markdown-call",
                  toolName: "createMarkdownArtifact",
                  input: { title: "Gate 2 文档", content: "# 内容" },
                  output: { created: true, artifactId: "ignored-by-finalizer" },
                },
                { type: "text-start", id: "text-1" },
                { type: "text-delta", id: "text-1", text: "文档已创建" },
                { type: "text-end", id: "text-1" },
                {
                  type: "finish",
                  finishReason: "stop",
                  rawFinishReason: "stop",
                  totalUsage: {
                    inputTokens: 7,
                    outputTokens: 5,
                    totalTokens: 12,
                  },
                },
              ]),
              usage: Promise.resolve({
                inputTokens: 7,
                outputTokens: 5,
                totalTokens: 12,
              }),
            }
          },
        },
      }),
  })
  const immediateEvents = []
  store.subscribe(assistantId, (event) => immediateEvents.push(event))
  const duplicate = store.start({
    messageId: assistantId,
    initialSnapshot: streaming.initialAssistantSnapshot({
      messageId: assistantId,
      threadId: rootThreadId,
    }),
    run: async () => {
      prepareCount += 100
    },
  })
  assert.equal(duplicate.started, false)
  await started.session.task
  assert.equal(prepareCount, 1, "一个 Message 只能启动一次模型 pipeline")
  assert.equal(immediateEvents[0].type, "snapshot")
  assert.equal(immediateEvents.at(-1).type, "terminal")

  const completed = await application.getMessage(userId, assistantId)
  assert.equal(completed.status, "completed")
  assert(completed.parts.some((part) => part.type === "tool-createMarkdownArtifact"))
  const [completedRow] = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, assistantId))
  assert.deepEqual(completedRow.providerUsage, {
    inputTokens: 7,
    outputTokens: 5,
    totalTokens: 12,
  })
  const artifactRows = await db
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.sourceMessageId, assistantId))
  assert.equal(artifactRows.length, 1)
  assert.equal(artifactRows[0].title, "Gate 2 文档")
  assert.equal(
    await application.getArtifact(otherUserId, artifactRows[0].id),
    null,
    "Artifact read 必须 owner-scoped"
  )

  // checkpoint 必须保留 parts；进程重启只把状态收敛为 failed。
  const restartTurn = await send(rootThreadId, "重启演练")
  const restartId = restartTurn.result.assistantMessage.id
  const checkpoint = new streaming.MessageCheckpointer(restartId)
  const partial = terminalSnapshot(restartId, rootThreadId, "checkpoint")
  await checkpoint.flush(partial)
  checkpoint.stop()
  const swept = await streaming.sweepInterruptedGenerations()
  assert.equal(swept, 1)
  const restarted = await application.getMessage(userId, restartId)
  assert.equal(restarted.status, "failed")
  assert.equal(restarted.error.code, "PROCESS_RESTARTED")
  assert.equal(restarted.parts[0].text, "checkpoint")

  // Session 丢失时 Stop 收敛为 failed，绝不伪造 stopped。
  const lostTurn = await send(rootThreadId, "Session 丢失")
  const lostId = lostTurn.result.assistantMessage.id
  const stop = await application.requestMessageStop(userId, lostId, {
    commandId: id(),
  })
  assert.equal(stop.result.status, "generating")
  await streaming.failOrphanedGeneratingMessage(lostId)
  const lost = await application.getMessage(userId, lostId)
  assert.equal(lost.status, "failed")
  assert.equal(lost.error.code, "SESSION_LOST")

  // complete 与 stopped 同时 finalize，数据库 CAS 只允许一个终态获胜。
  const raceTurn = await send(rootThreadId, "终态竞态")
  const raceId = raceTurn.result.assistantMessage.id
  const raceSnapshot = terminalSnapshot(raceId, rootThreadId, "race")
  const raced = await Promise.all([
    streaming.finalizeGeneration({
      messageId: raceId,
      snapshot: raceSnapshot,
      status: "completed",
      finishReason: "stop",
    }),
    streaming.finalizeGeneration({
      messageId: raceId,
      snapshot: raceSnapshot,
      status: "stopped",
      finishReason: "stop",
    }),
  ])
  assert.equal(raced[0].status, raced[1].status)
  assert(["completed", "stopped"].includes(raced[0].status))

  const emptyTurn = await send(rootThreadId, "空回复")
  const emptyId = emptyTurn.result.assistantMessage.id
  const empty = await streaming.finalizeGeneration({
    messageId: emptyId,
    snapshot: streaming.initialAssistantSnapshot({
      messageId: emptyId,
      threadId: rootThreadId,
    }),
    status: "completed",
    finishReason: "stop",
  })
  assert.equal(empty.status, "failed")
  assert.equal(empty.error.code, "EMPTY_RESPONSE")

  const partialTurn = await send(rootThreadId, "部分错误")
  const partialId = partialTurn.result.assistantMessage.id
  const partialFailed = await streaming.finalizeGeneration({
    messageId: partialId,
    snapshot: terminalSnapshot(partialId, rootThreadId, "partial content"),
    status: "failed",
    finishReason: "error",
    error: { code: "GENERATION_FAILED", message: "受控错误" },
  })
  assert.equal(partialFailed.status, "failed")
  assert.equal(partialFailed.parts[0].text, "partial content")

  // Session 已不存在时，权威 Message 仍可独立轮询。
  store.sessions.delete(assistantId)
  assert.equal(store.get(assistantId), null)
  assert.equal((await application.getMessage(userId, assistantId)).status, "completed")

  console.log("normalized generation Gate 2 DB tests passed")
} finally {
  await db.delete(schema.user).where(and(eq(schema.user.id, userId)))
  await db.delete(schema.user).where(and(eq(schema.user.id, otherUserId)))
  await globalThis.__dbClient?.end()
}
