import assert from "node:assert/strict"
import { eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import {
  artifacts,
  messages,
  projects,
  threads,
  user,
} from "../../lib/db/schema.ts"
import { resolveQuoteSelections } from "../../lib/thread-chat/application/quote-selections.ts"

const id = () => crypto.randomUUID()
const userId = id()
const projectId = id()
const threadA = id()
const threadB = id()
const messageA = id()
const stoppedA = id()
const messageB = id()
const artifactB = id()
const now = new Date()
const anchor = (exact) => ({
  quote: { exact, prefix: "", suffix: "" },
  position: { start: 0, end: exact.length },
})

async function reject(selection, pattern) {
  await assert.rejects(
    db.transaction((tx) =>
      resolveQuoteSelections({
        tx,
        userId,
        destinationProjectId: projectId,
        destinationThreadId: threadA,
        selections: [selection],
      })
    ),
    pattern
  )
}

try {
  await db.insert(user).values({
    id: userId,
    name: "Prompt Cache Test",
    email: `prompt-cache-${userId}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(projects).values({ id: projectId, userId })
  await db.insert(threads).values({
    id: threadA,
    projectId,
    parentId: null,
    forkContext: [],
    depth: 0,
    modelId: "doubao-seed-2.1-turbo",
  })
  await db.insert(messages).values([
    {
      id: messageA,
      projectId,
      threadId: threadA,
      sequence: 1,
      role: "assistant",
      parts: [{ type: "text", text: "A completed" }],
      status: "completed",
      modelId: "doubao-seed-2.1-turbo",
      startedAt: now,
      finishedAt: now,
    },
    {
      id: stoppedA,
      projectId,
      threadId: threadA,
      sequence: 2,
      role: "assistant",
      parts: [{ type: "text", text: "A stopped" }],
      status: "stopped",
      modelId: "doubao-seed-2.1-turbo",
      startedAt: now,
      finishedAt: now,
    },
  ])
  await db.insert(threads).values({
    id: threadB,
    projectId,
    parentId: threadA,
    forkMessageId: messageA,
    forkContext: [messageA],
    forkAnchor: anchor("A completed"),
    anchorText: "A completed",
    footnote: 1,
    depth: 1,
    modelId: "doubao-seed-2.1-turbo",
  })
  await db.insert(messages).values({
    id: messageB,
    projectId,
    threadId: threadB,
    sequence: 1,
    role: "assistant",
    parts: [{ type: "text", text: "B completed" }],
    status: "completed",
    modelId: "doubao-seed-2.1-turbo",
    startedAt: now,
    finishedAt: now,
  })
  await db.insert(artifacts).values({
    id: artifactB,
    projectId,
    sourceMessageId: messageB,
    kind: "markdown",
    title: "B artifact",
    content: "B artifact content",
    metadata: {},
  })

  const accepted = await db.transaction((tx) =>
    resolveQuoteSelections({
      tx,
      userId,
      destinationProjectId: projectId,
      destinationThreadId: threadA,
      selections: [
        {
          source: {
            type: "message-selection",
            sourceMessageId: messageA,
            anchor: anchor("A completed"),
          },
          comment: "explain",
        },
      ],
    })
  )
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].source.threadId, threadA)

  await reject(
    {
      source: {
        type: "message-selection",
        sourceMessageId: messageB,
        anchor: anchor("B completed"),
      },
    },
    /当前 Thread/
  )
  await reject(
    {
      source: {
        type: "artifact-selection",
        artifactId: artifactB,
        anchor: anchor("B artifact content"),
      },
      comment: "change",
    },
    /当前 Thread/
  )
  await reject(
    {
      source: {
        type: "message-selection",
        sourceMessageId: stoppedA,
        anchor: anchor("A stopped"),
      },
    },
    /已完成/
  )

  const count = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.projectId, projectId))
  assert.equal(count.length, 3)
  console.log("prompt-cache database quote policy tests passed")
} finally {
  await db.delete(user).where(eq(user.id, userId)).catch(() => undefined)
}
