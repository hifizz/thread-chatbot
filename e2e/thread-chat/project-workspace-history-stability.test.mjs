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
const prefix = `project-history-${id()}`
const userId = `${prefix}-owner`
const modelId = constants.DEFAULT_THREAD_CHAT_MODEL_ID
const now = () => new Date()

try {
  await db.insert(schema.user).values({
    id: userId,
    name: "Project History Stability",
    email: `${prefix}@example.test`,
    emailVerified: true,
    createdAt: now(),
    updatedAt: now(),
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
    text: "历史稳定性基线",
    files: [],
  })

  const sourceAssistantId = started.result.assistantMessage.id
  const finishedAt = now()
  await db
    .update(schema.messages)
    .set({
      status: "completed",
      parts: [{ type: "text", text: "IMMUTABLE_HISTORY_MARKER" }],
      finishedAt,
      updatedAt: finishedAt,
    })
    .where(eq(schema.messages.id, sourceAssistantId))

  const artifactId = id()
  await db.insert(schema.artifacts).values({
    id: artifactId,
    projectId,
    threadId: rootThreadId,
    sourceMessageId: sourceAssistantId,
    kind: "markdown",
    title: "Immutable Artifact",
    content: "# IMMUTABLE_ARTIFACT_BODY",
    metadata: { immutable: true },
  })

  const childThreadId = id()
  const fork = await application.forkThread(userId, rootThreadId, {
    commandId: id(),
    threadId: childThreadId,
    sourceMessageId: sourceAssistantId,
    anchorText: "IMMUTABLE_HISTORY_MARKER",
    anchor: {
      quote: {
        exact: "IMMUTABLE_HISTORY_MARKER",
        prefix: "",
        suffix: "",
      },
    },
    modelId,
  })

  const before = await application.getProjectBootstrap(userId, projectId)
  const beforeMessage = structuredClone(
    before.messages.find((message) => message.id === sourceAssistantId)
  )
  const beforeArtifact = structuredClone(
    before.artifacts.find((artifact) => artifact.id === artifactId)
  )
  const beforeForkContext = structuredClone(fork.result.thread.forkContext)
  assert.ok(beforeMessage)
  assert.ok(beforeArtifact)
  assert.ok(beforeForkContext.includes(sourceAssistantId))

  const attachmentId = id()
  await db.insert(schema.attachments).values({
    id: attachmentId,
    userId,
    key: `${prefix}/${attachmentId}.pdf`,
    filename: "stable.pdf",
    mimeType: "application/pdf",
    size: 64,
    kind: "document",
    status: "ready",
    pageCount: 1,
    pages: ["PROJECT_FILE_SNAPSHOT_MARKER"],
  })
  await application.addProjectFile(userId, projectId, {
    commandId: id(),
    attachmentId,
  })
  await application.updateProjectContract(userId, projectId, {
    commandId: id(),
    expectedContractVersion: 0,
    target: "New target",
    instructions: "New instructions",
  })

  // A compiled generation context is a value snapshot. Removing the Project File later
  // cannot mutate the already-returned snapshot, while the next compilation no longer sees it.
  const compiledBeforeRemove = await compiler.compileModelContextWithProject({
    userId,
    threadId: childThreadId,
  })
  assert.ok(compiledBeforeRemove.projectFileIds.includes(attachmentId))

  await application.removeProjectFile(userId, projectId, {
    commandId: id(),
    attachmentId,
  })
  assert.ok(
    compiledBeforeRemove.projectFileIds.includes(attachmentId),
    "已启动 generation 的 Project File 快照不得被后续 remove 改写"
  )
  const compiledAfterRemove = await compiler.compileModelContextWithProject({
    userId,
    threadId: childThreadId,
  })
  assert.equal(compiledAfterRemove.projectFileIds.includes(attachmentId), false)

  const after = await application.getProjectBootstrap(userId, projectId)
  assert.deepEqual(
    after.messages.find((message) => message.id === sourceAssistantId),
    beforeMessage,
    "Contract/File 更新不得改写已完成 Message"
  )
  assert.deepEqual(
    after.artifacts.find((artifact) => artifact.id === artifactId),
    beforeArtifact,
    "Contract/File 更新不得改写已有 Artifact"
  )
  assert.deepEqual(
    after.threads.find((thread) => thread.id === childThreadId)?.forkContext,
    beforeForkContext,
    "Contract/File 更新不得改写 Fork Context"
  )

  console.log("project workspace history stability tests passed")
} finally {
  await db.delete(schema.user).where(and(eq(schema.user.id, userId)))
  await globalThis.__dbClient?.end()
}
