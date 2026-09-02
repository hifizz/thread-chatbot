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

const [drizzle, { db }, schema, application, constants, compiler] = await Promise.all([
  import("drizzle-orm"),
  import("../../lib/db/index.ts"),
  import("../../lib/db/schema.ts"),
  import("../../lib/thread-chat/application/index.ts"),
  import("../../constants/model.ts"),
  import("../../lib/thread-chat/application/compile-model-context.ts"),
])

const { and, eq } = drizzle
const id = () => crypto.randomUUID()
const prefix = `artifact-context-${id()}`
const userId = `${prefix}-owner`
const modelId = constants.DEFAULT_THREAD_CHAT_MODEL_ID
const ARTIFACT_SECRET = "PROJECT_ARTIFACT_BODY_SECRET_MUST_NOT_LEAK"
const SOURCE_MESSAGE_MARKER = "SOURCE_ASSISTANT_IS_IN_INHERITED_HISTORY"

function serialized(messages) {
  return JSON.stringify(messages)
}

try {
  await db.insert(schema.user).values({
    id: userId,
    name: "Artifact Context Isolation",
    email: `${prefix}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const projectId = id()
  const rootThreadId = id()
  const started = await application.startProject(userId, {
    commandId: id(),
    projectId,
    rootThreadId,
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "ROOT_USER_BOUNDARY",
    files: [],
  })
  const userMessageId = started.result.userMessage.id
  const assistantMessageId = started.result.assistantMessage.id
  const terminalAt = new Date()
  await db
    .update(schema.messages)
    .set({
      status: "completed",
      parts: [{ type: "text", text: SOURCE_MESSAGE_MARKER }],
      finishedAt: terminalAt,
      updatedAt: terminalAt,
    })
    .where(eq(schema.messages.id, assistantMessageId))

  const artifactId = id()
  await db.insert(schema.artifacts).values({
    id: artifactId,
    projectId,
    threadId: rootThreadId,
    sourceMessageId: assistantMessageId,
    kind: "markdown",
    title: "Secret artifact",
    content: `# ${ARTIFACT_SECRET}`,
    metadata: {},
  })

  // Fork before the producing assistant: Project Artifacts lists the artifact globally,
  // but that fact alone must not inject its body or its source assistant into this Thread.
  const isolatedThreadId = id()
  await application.forkThread(userId, rootThreadId, {
    commandId: id(),
    threadId: isolatedThreadId,
    sourceMessageId: userMessageId,
    anchorText: "ROOT_USER_BOUNDARY",
    anchor: {
      quote: { exact: "ROOT_USER_BOUNDARY", prefix: "", suffix: "" },
    },
    modelId,
  })
  const isolatedContext = await compiler.compileModelContextWithProject({
    userId,
    threadId: isolatedThreadId,
  })
  const isolatedSerialized = serialized(isolatedContext.messages)
  assert.doesNotMatch(isolatedSerialized, new RegExp(ARTIFACT_SECRET))
  assert.doesNotMatch(isolatedSerialized, new RegExp(SOURCE_MESSAGE_MARKER))

  const bootstrap = await application.getProjectBootstrap(userId, projectId)
  assert.ok(
    bootstrap.artifacts.some((artifact) => artifact.id === artifactId),
    "Artifact 应出现在 Project-wide library，但不因此进入无关 Thread context"
  )

  // Fork after the producing assistant: existing inherited-message serialization remains
  // intact. The source assistant text is available because it is inherited history, while
  // the separate persisted Artifact body is still not globally injected.
  const inheritedThreadId = id()
  await application.forkThread(userId, rootThreadId, {
    commandId: id(),
    threadId: inheritedThreadId,
    sourceMessageId: assistantMessageId,
    anchorText: SOURCE_MESSAGE_MARKER,
    anchor: {
      quote: { exact: SOURCE_MESSAGE_MARKER, prefix: "", suffix: "" },
    },
    modelId,
  })
  const inheritedContext = await compiler.compileModelContextWithProject({
    userId,
    threadId: inheritedThreadId,
  })
  const inheritedSerialized = serialized(inheritedContext.messages)
  assert.match(inheritedSerialized, new RegExp(SOURCE_MESSAGE_MARKER))
  assert.doesNotMatch(inheritedSerialized, new RegExp(ARTIFACT_SECRET))

  console.log("project artifact context isolation tests passed")
} finally {
  await db.delete(schema.user).where(and(eq(schema.user.id, userId)))
  await globalThis.__dbClient?.end()
}
