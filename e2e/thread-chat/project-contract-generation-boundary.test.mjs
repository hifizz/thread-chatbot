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
const prefix = `project-contract-boundary-${id()}`
const userId = `${prefix}-owner`
const modelId = constants.DEFAULT_THREAD_CHAT_MODEL_ID

function completedStream(text = "ok") {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "start" })
      controller.enqueue({ type: "text-start", id: "text" })
      controller.enqueue({ type: "text-delta", id: "text", text })
      controller.enqueue({ type: "text-end", id: "text" })
      controller.enqueue({
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })
      controller.close()
    },
  })
}

async function createUser() {
  await db.insert(schema.user).values({
    id: userId,
    name: "Project Contract Boundary",
    email: `${prefix}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function runAndCapture({ messageId, threadId, beforeRelease }) {
  const store = new streaming.SessionStore({ startCleanupTimer: false })
  let captured
  let release
  const enteredPrepare = new Promise((resolve) => {
    release = resolve
  })
  let prepared
  const prepareEntered = new Promise((resolve) => {
    prepared = resolve
  })

  const started = store.start({
    messageId,
    initialSnapshot: streaming.initialAssistantSnapshot({
      messageId,
      threadId,
      modelId,
    }),
    run: (session) =>
      streaming.runGeneration({
        userId,
        messageId,
        session,
        dependencies: {
          prepare: async (input) => {
            captured = structuredClone(input.projectContract)
            prepared()
            await enteredPrepare
            return { textStream: completedStream() }
          },
        },
      }),
  })

  await prepareEntered
  await beforeRelease?.(captured)
  release()
  await started.session.task
  store.dispose()
  return captured
}

try {
  await createUser()
  const projectId = id()
  const rootThreadId = id()
  const startedProject = await application.startProject(userId, {
    commandId: id(),
    projectId,
    rootThreadId,
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "建立 Project",
    files: [],
  })

  let project = await application.updateProjectContract(userId, projectId, {
    commandId: id(),
    expectedContractVersion: 0,
    target: "Target v1",
    instructions: "Instructions v1",
  })
  assert.equal(project.result.contractVersion, 1)

  const rootTurn = await application.sendMessage(userId, rootThreadId, {
    commandId: id(),
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "第一轮",
    files: [],
  })

  const firstSnapshot = await runAndCapture({
    messageId: rootTurn.result.assistantMessage.id,
    threadId: rootThreadId,
    beforeRelease: async (captured) => {
      assert.deepEqual(captured, {
        target: "Target v1",
        instructions: "Instructions v1",
        version: 1,
      })
      project = await application.updateProjectContract(userId, projectId, {
        commandId: id(),
        expectedContractVersion: 1,
        target: "Target v2",
        instructions: "Instructions v2",
      })
      assert.equal(project.result.contractVersion, 2)
    },
  })
  assert.equal(firstSnapshot.version, 1, "运行中的 Generation 必须固定启动时 Contract")

  const secondTurn = await application.sendMessage(userId, rootThreadId, {
    commandId: id(),
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "第二轮",
    files: [],
  })
  const secondSnapshot = await runAndCapture({
    messageId: secondTurn.result.assistantMessage.id,
    threadId: rootThreadId,
  })
  assert.deepEqual(secondSnapshot, {
    target: "Target v2",
    instructions: "Instructions v2",
    version: 2,
  })

  const sourceMessageId = startedProject.result.userMessage.id
  const childThreadId = id()
  const fork = await application.forkThread(userId, rootThreadId, {
    commandId: id(),
    threadId: childThreadId,
    sourceMessageId,
    anchorText: "建立 Project",
    anchor: {
      quote: { exact: "建立 Project", prefix: "", suffix: "" },
    },
    modelId,
  })
  const frozenBefore = structuredClone(fork.result.thread.forkContext)
  assert.ok(frozenBefore.length > 0)

  project = await application.updateProjectContract(userId, projectId, {
    commandId: id(),
    expectedContractVersion: 2,
    target: "Target v3",
    instructions: "Instructions v3",
  })
  assert.equal(project.result.contractVersion, 3)

  const childTurn = await application.sendMessage(userId, childThreadId, {
    commandId: id(),
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "旧 Fork 中的新请求",
    files: [],
  })
  const childSnapshot = await runAndCapture({
    messageId: childTurn.result.assistantMessage.id,
    threadId: childThreadId,
  })
  assert.deepEqual(childSnapshot, {
    target: "Target v3",
    instructions: "Instructions v3",
    version: 3,
  })

  const bootstrap = await application.getProjectBootstrap(userId, projectId)
  const childAfter = bootstrap.threads.find((thread) => thread.id === childThreadId)
  assert.ok(childAfter)
  assert.deepEqual(
    childAfter.forkContext,
    frozenBefore,
    "Contract 更新不得改写旧 Fork 的冻结上下文"
  )

  console.log("project contract generation boundary tests passed")
} finally {
  await db.delete(schema.user).where(and(eq(schema.user.id, userId)))
  await globalThis.__dbClient?.end()
}
