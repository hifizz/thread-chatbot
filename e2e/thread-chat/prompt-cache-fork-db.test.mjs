import assert from "node:assert/strict"
import { eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { messages, projects, threads, user } from "../../lib/db/schema.ts"
import { forkThread } from "../../lib/thread-chat/application/fork-thread.ts"
import { sendMessage } from "../../lib/thread-chat/application/send-message.ts"
import { threadQuotePartToModelText } from "../../lib/thread-chat/domain/thread-quote.ts"

const id = () => crypto.randomUUID()
const userId = id()
const projectId = id()
const rootThreadId = id()
const sourceUserId = id()
const sourceAssistantId = id()
const directThreadId = id()
const delayedThreadId = id()
const now = new Date()
const modelId = "doubao-seed-2.1-turbo"
const selectedText = "缓存应该复用共同前缀"
const anchor = {
  quote: { exact: selectedText, prefix: "", suffix: "" },
  position: { start: 0, end: selectedText.length },
}

function modelVisible(parts) {
  return parts.map((part) => {
    if (part.type === "data-quote") return threadQuotePartToModelText(part.data)
    if (part.type === "text") return part.text
    if (part.type === "file") return `file:${part.mediaType}`
    return part.type
  })
}

try {
  await db.insert(user).values({
    id: userId,
    name: "Prompt Cache Fork Test",
    email: `prompt-cache-fork-${userId}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(projects).values({ id: projectId, userId })
  await db.insert(threads).values({
    id: rootThreadId,
    projectId,
    parentId: null,
    forkContext: [],
    depth: 0,
    modelId,
    nextSequence: 3,
  })
  await db.insert(messages).values([
    {
      id: sourceUserId,
      projectId,
      threadId: rootThreadId,
      sequence: 1,
      role: "user",
      parts: [{ type: "text", text: "解释缓存" }],
      status: "completed",
      finishedAt: now,
    },
    {
      id: sourceAssistantId,
      projectId,
      threadId: rootThreadId,
      sequence: 2,
      role: "assistant",
      parts: [{ type: "text", text: selectedText }],
      status: "completed",
      modelId,
      startedAt: now,
      finishedAt: now,
    },
  ])

  const direct = await forkThread(userId, rootThreadId, {
    commandId: id(),
    threadId: directThreadId,
    sourceMessageId: sourceAssistantId,
    anchorText: selectedText,
    anchor,
    modelId,
    firstTurn: {
      userMessageId: id(),
      assistantMessageId: id(),
      text: "为什么？",
      files: [],
      additionalQuotes: [],
    },
  })
  assert.ok(direct.generation)

  const empty = await forkThread(userId, rootThreadId, {
    commandId: id(),
    threadId: delayedThreadId,
    sourceMessageId: sourceAssistantId,
    anchorText: selectedText,
    anchor,
    modelId,
  })
  assert.equal(empty.generation, null)
  const beforeSend = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.threadId, delayedThreadId))
  assert.equal(beforeSend.length, 0)

  const delayed = await sendMessage(userId, delayedThreadId, {
    commandId: id(),
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "为什么？",
    files: [],
    quotes: [],
  })
  assert.ok(delayed.userMessage)

  assert.deepEqual(
    modelVisible(direct.generation.userMessage.parts),
    modelVisible(delayed.userMessage.parts)
  )
  assert.equal(direct.generation.userMessage.parts[0].type, "data-quote")
  assert.equal(delayed.userMessage.parts[0].type, "data-quote")
  assert.equal(direct.generation.userMessage.parts[1].text, "为什么？")
  assert.equal(delayed.userMessage.parts[1].text, "为什么？")

  console.log("prompt-cache fork database tests passed")
} finally {
  await db.delete(user).where(eq(user.id, userId)).catch(() => undefined)
}
