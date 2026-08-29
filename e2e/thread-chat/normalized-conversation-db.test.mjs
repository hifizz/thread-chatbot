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

const [
  { and, eq },
  { db },
  schema,
  commands,
  repositories,
  constants,
  feedbackOutbox,
] = await Promise.all([
  import("drizzle-orm"),
  import("../../lib/db/index.ts"),
  import("../../lib/db/schema.ts"),
  import("../../lib/thread-chat/application/index.ts"),
  import("../../lib/thread-chat/persistence/index.ts"),
  import("../../constants/model.ts"),
  import("../../lib/observability/feedback-outbox.ts"),
])

const id = () => crypto.randomUUID()
const prefix = `gate1-${id()}`
const userA = `${prefix}-a`
const userB = `${prefix}-b`
const projectA = id()
const projectB = id()
const rootA = id()
const rootB = id()
const modelId = constants.DEFAULT_THREAD_CHAT_MODEL_ID

async function createUser(userId, suffix) {
  await db.insert(schema.user).values({
    id: userId,
    name: `Gate 1 ${suffix}`,
    email: `${prefix}-${suffix}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function settle(messageId, status = "failed") {
  await db
    .update(schema.messages)
    .set({
      status,
      finishedAt: new Date(),
      errorCode: status === "failed" ? "TEST_FAILURE" : null,
      errorMessage: status === "failed" ? "受控测试失败" : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.messages.id, messageId))
}

try {
  await createUser(userA, "a")
  await createUser(userB, "b")

  const startACommand = {
    commandId: id(),
    projectId: projectA,
    rootThreadId: rootA,
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "项目 A 的第一问",
    files: [],
  }
  const firstStart = await commands.startProject(userA, startACommand)
  assert.equal(firstStart.replayed, false)
  assert.equal(firstStart.result.assistantMessage.status, "generating")
  const replayedStart = await commands.startProject(userA, startACommand)
  assert.equal(replayedStart.replayed, true)
  assert.equal(
    replayedStart.result.assistantMessage.id,
    firstStart.result.assistantMessage.id
  )
  await assert.rejects(
    () =>
      commands.startProject(userA, {
        ...startACommand,
        text: "同 ID 的不同语义",
      }),
    (error) => error.name === "CommandIdConflictError"
  )
  await assert.rejects(() =>
    db.insert(schema.threads).values({
      id: id(),
      projectId: projectA,
      depth: 0,
      modelId,
    })
  )
  await assert.rejects(() =>
    db.insert(schema.messages).values({
      id: id(),
      projectId: projectA,
      threadId: rootA,
      sequence: 1,
      role: "user",
      parts: [{ type: "text", text: "重复 sequence" }],
      status: "completed",
      finishedAt: new Date(),
    })
  )

  assert.equal(
    await commands.getProjectBootstrap(userB, projectA).then((x) => x.project),
    null
  )
  assert.equal(
    await commands.getMessage(userB, startACommand.userMessageId),
    null
  )

  const startBCommand = {
    commandId: id(),
    projectId: projectB,
    rootThreadId: rootB,
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "项目 B 的第一问",
    files: [],
  }
  await commands.startProject(userA, startBCommand)

  const allocatedSequences = await Promise.all([
    repositories.withConversationTransaction((tx) =>
      repositories.allocateThreadSequences(tx, rootA, 2)
    ),
    repositories.withConversationTransaction((tx) =>
      repositories.allocateThreadSequences(tx, rootA, 2)
    ),
  ])
  assert.equal(new Set(allocatedSequences.flat()).size, 4)
  const footnotes = await Promise.all([
    repositories.withConversationTransaction((tx) =>
      repositories.allocateProjectFootnote(tx, projectA)
    ),
    repositories.withConversationTransaction((tx) =>
      repositories.allocateProjectFootnote(tx, projectA)
    ),
  ])
  assert.equal(new Set(footnotes).size, 2)

  await assert.rejects(
    () =>
      commands.forkThread(userA, rootA, {
        commandId: id(),
        threadId: id(),
        sourceMessageId: startBCommand.assistantMessageId,
        anchorText: "跨项目",
        anchor: { quote: { exact: "跨项目", prefix: "", suffix: "" } },
        modelId,
      }),
    (error) => error.code === "STATE_CONFLICT"
  )

  await settle(startACommand.assistantMessageId)
  const retryOne = {
    commandId: id(),
    assistantMessageId: id(),
    modelId,
  }
  const retryTwo = {
    commandId: id(),
    assistantMessageId: id(),
    modelId,
  }
  const retryRace = await Promise.allSettled([
    commands.retryMessage(userA, startACommand.assistantMessageId, retryOne),
    commands.retryMessage(userA, startACommand.assistantMessageId, retryTwo),
  ])
  assert.equal(
    retryRace.filter((result) => result.status === "fulfilled").length,
    1
  )
  const retryResult = retryRace.find(
    (result) => result.status === "fulfilled"
  ).value
  const replacementId = retryResult.result.assistantMessage.id
  const sourceAfterRetry = await commands.getMessage(
    userA,
    startACommand.assistantMessageId
  )
  assert.equal(sourceAfterRetry.status, "failed")
  assert.ok(sourceAfterRetry.supersededAt)

  await settle(replacementId)
  const editResult = await commands.editLatestTurn(
    userA,
    startACommand.userMessageId,
    {
      commandId: id(),
      userMessageId: id(),
      assistantMessageId: id(),
      modelId,
      text: "编辑后的第一问",
      files: [],
    }
  )
  assert.equal(
    editResult.result.generation.assistantMessage.status,
    "generating"
  )
  assert.equal(
    editResult.result.generation.userMessage.replacesMessageId,
    startACommand.userMessageId
  )

  const foreignAttachmentId = id()
  await db.insert(schema.attachments).values({
    id: foreignAttachmentId,
    userId: userB,
    key: `attachments/${foreignAttachmentId}.pdf`,
    filename: "foreign.pdf",
    mimeType: "application/pdf",
    size: 10,
    kind: "document",
    status: "ready",
  })
  await settle(editResult.result.generation.assistantMessage.id)
  await assert.rejects(
    () =>
      commands.sendMessage(userA, rootA, {
        commandId: id(),
        userMessageId: id(),
        assistantMessageId: id(),
        modelId,
        text: "尝试引用他人的附件",
        files: [
          {
            url: `/api/attachments/${foreignAttachmentId}`,
            mediaType: "application/pdf",
            filename: "foreign.pdf",
          },
        ],
      }),
    (error) => error.code === "NOT_FOUND"
  )

  const sendCommand = {
    commandId: id(),
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "验证 send、stop、feedback 和 fork",
    files: [],
  }
  const sent = await commands.sendMessage(userA, rootA, sendCommand)
  assert.equal(sent.replayed, false)
  const sentReplay = await commands.sendMessage(userA, rootA, sendCommand)
  assert.equal(sentReplay.replayed, true)
  assert.equal(
    sentReplay.result.assistantMessage.id,
    sent.result.assistantMessage.id
  )
  const stopCommand = { commandId: id() }
  const stopped = await commands.requestMessageStop(
    userA,
    sendCommand.assistantMessageId,
    stopCommand
  )
  assert.equal(stopped.result.status, "generating")
  assert.equal(
    (
      await commands.requestMessageStop(
        userA,
        sendCommand.assistantMessageId,
        stopCommand
      )
    ).replayed,
    true
  )
  await settle(sendCommand.assistantMessageId, "completed")
  await db
    .update(schema.messages)
    .set({ parts: [{ type: "text", text: "可用于分支的回复" }] })
    .where(eq(schema.messages.id, sendCommand.assistantMessageId))
  const feedbackCommand = { commandId: id(), feedback: "up" }
  const feedback = await commands.setMessageFeedback(
    userA,
    sendCommand.assistantMessageId,
    feedbackCommand
  )
  assert.equal(feedback.result.feedback, "up")
  assert.equal(
    (
      await commands.setMessageFeedback(
        userA,
        sendCommand.assistantMessageId,
        feedbackCommand
      )
    ).replayed,
    true
  )
  const clearedFeedback = await commands.setMessageFeedback(
    userA,
    sendCommand.assistantMessageId,
    { commandId: id(), feedback: null }
  )
  assert.equal(clearedFeedback.result.feedback, null)
  const [feedbackDelivery] = await db
    .select()
    .from(schema.feedbackScoreOutbox)
    .where(
      eq(schema.feedbackScoreOutbox.messageId, sendCommand.assistantMessageId)
    )
  assert.equal(feedbackDelivery.value, "cleared")
  assert.equal(feedbackDelivery.version, 2)
  assert.equal(feedbackDelivery.deliveredVersion, 0)
  const mirroredFeedback = []
  const concurrentDrains = await Promise.all(
    [0, 1].map(() =>
      feedbackOutbox.drainFeedbackScoreOutbox({
        messageId: sendCommand.assistantMessageId,
        mirror: async (value) => {
          mirroredFeedback.push(value)
          return {
            status: "mirrored",
            traceId: "test-trace",
            scoreId: "test-score",
            value: "cleared",
          }
        },
      })
    )
  )
  assert.equal(
    concurrentDrains.reduce((total, result) => total + result.claimed, 0),
    1
  )
  assert.deepEqual(
    mirroredFeedback.map((value) => ({
      feedback: value.feedback,
      version: value.version,
    })),
    [{ feedback: null, version: 2 }]
  )
  const [deliveredFeedback] = await db
    .select()
    .from(schema.feedbackScoreOutbox)
    .where(
      eq(schema.feedbackScoreOutbox.messageId, sendCommand.assistantMessageId)
    )
  assert.equal(deliveredFeedback.deliveredVersion, 2)

  const forkCommand = {
    commandId: id(),
    threadId: id(),
    sourceMessageId: sendCommand.assistantMessageId,
    anchorText: "可用于分支",
    anchor: {
      quote: { exact: "可用于分支", prefix: "", suffix: "的回复" },
    },
    modelId,
  }
  const forked = await commands.forkThread(userA, rootA, forkCommand)
  assert.equal(forked.replayed, false)
  assert.equal(forked.result.thread.parentId, rootA)
  assert.ok(
    forked.result.thread.forkContext.includes(sendCommand.assistantMessageId)
  )
  const forkReplay = await commands.forkThread(userA, rootA, forkCommand)
  assert.equal(forkReplay.replayed, true)
  assert.equal(forkReplay.result.thread.id, forked.result.thread.id)
  const compiledContext = await commands.compileModelContext({
    userId: userA,
    threadId: forkCommand.threadId,
  })
  assert.ok(compiledContext.length > 0)

  assert.equal(await commands.claimTitleGenerationAttempt(userA, rootA), true)
  assert.equal(await commands.claimTitleGenerationAttempt(userA, rootA), false)
  assert.equal(
    await commands.saveGeneratedTitle(userA, rootA, "自动标题"),
    true
  )
  const titled = await commands.getProjectBootstrap(userA, projectA)
  assert.equal(titled.project.autoTitle, "自动标题")
  assert.equal(
    titled.threads.find((thread) => thread.id === rootA).autoTitle,
    "自动标题"
  )

  const protocolThread = id()
  await db.insert(schema.threads).values({
    id: protocolThread,
    projectId: projectA,
    parentId: rootA,
    forkMessageId: editResult.result.generation.assistantMessage.id,
    forkContext: [editResult.result.generation.assistantMessage.id],
    forkAnchor: { quote: { exact: "协议", prefix: "", suffix: "" } },
    anchorText: "协议",
    footnote: 9999,
    depth: 1,
    modelId,
  })
  const protocolMessageId = id()
  const allParts = [
    { type: "text", text: "正文" },
    { type: "reasoning", text: "推理", state: "done" },
    {
      type: "source-url",
      sourceId: "source-1",
      url: "https://example.test/source",
      title: "来源",
    },
    {
      type: "file",
      url: "/api/attachments/00000000-0000-4000-8000-000000000000",
      mediaType: "application/pdf",
      filename: "fixture.pdf",
    },
    {
      type: "tool-createMarkdownArtifact",
      toolCallId: "tool-1",
      state: "output-available",
      input: { title: "产物", content: "# 产物" },
      output: { created: true, artifactId: "artifact-fixture" },
    },
    { type: "data-quote", data: { text: "引用" } },
    {
      type: "data-artifact-progress",
      data: { phase: "writing" },
      transient: true,
    },
  ]
  const persistentParts = repositories.persistentMessageParts(allParts)
  await db.insert(schema.messages).values({
    id: protocolMessageId,
    projectId: projectA,
    threadId: protocolThread,
    sequence: 1,
    role: "assistant",
    parts: persistentParts,
    status: "completed",
    modelId,
    finishedAt: new Date(),
  })
  const [roundTrip] = await db
    .select({ parts: schema.messages.parts })
    .from(schema.messages)
    .where(eq(schema.messages.id, protocolMessageId))
  assert.deepEqual(roundTrip.parts, persistentParts)
  assert.equal(
    roundTrip.parts.some((part) => part.transient === true),
    false
  )
  assert.deepEqual(
    roundTrip.parts.map((part) => part.type),
    [
      "text",
      "reasoning",
      "source-url",
      "file",
      "tool-createMarkdownArtifact",
      "data-quote",
    ]
  )

  const deleteCommand = { commandId: id() }
  const deleted = await commands.deleteProject(userA, projectB, deleteCommand)
  assert.equal(deleted.result.deleted, true)
  const deleteReplay = await commands.deleteProject(
    userA,
    projectB,
    deleteCommand
  )
  assert.equal(deleteReplay.replayed, true)

  const raceProject = id()
  const raceStart = {
    commandId: id(),
    projectId: raceProject,
    rootThreadId: id(),
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "删除竞态",
    files: [],
  }
  await commands.startProject(userA, raceStart)
  const deleteRace = await Promise.allSettled([
    commands.deleteProject(userA, raceProject, { commandId: id() }),
    commands.deleteProject(userA, raceProject, { commandId: id() }),
  ])
  assert.equal(
    deleteRace.filter((result) => result.status === "fulfilled").length,
    1
  )

  console.log("normalized conversation Gate 1 DB tests passed")
} finally {
  await db.delete(schema.user).where(and(eq(schema.user.id, userA)))
  await db.delete(schema.user).where(and(eq(schema.user.id, userB)))
  await globalThis.__dbClient?.end()
}
