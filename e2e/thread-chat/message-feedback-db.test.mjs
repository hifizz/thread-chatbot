import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { branchTrees, user } from "../../lib/db/schema.ts"
import { finalizeGeneration } from "../../lib/thread-chat-generation/finalize.ts"
import { startGeneration } from "../../lib/thread-chat-generation/repository.ts"
import {
  listMessageFeedbackForTree,
  setMessageFeedbackForOwner,
} from "../../lib/thread-chat-generation/message-feedback-repository.ts"

const suffix = randomUUID()
const userId = `message-feedback-${suffix}`
const otherUserId = `message-feedback-other-${suffix}`
const treeId = randomUUID()
const generationId = randomUUID()

function state(status = "pending") {
  return {
    schemaVersion: 2,
    threads: {
      main: {
        id: "main",
        modelId: "glm-5.2",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages: [
          {
            id: "u1",
            parentMessageId: null,
            role: "user",
            text: "问题",
            forks: [],
          },
          {
            id: "a1",
            parentMessageId: "u1",
            role: "assistant",
            text: status === "done" ? "答案" : "",
            forks: [],
            generationId,
            status,
          },
        ],
        activeLeafMessageId: "a1",
        lastActive: 1,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 3,
    tick: 1,
  }
}

const result = {
  version: 1,
  generationId,
  text: "答案",
  status: "done",
  artifactIds: [],
  artifacts: {},
}

async function run() {
  await db.insert(user).values([
    {
      id: userId,
      name: "message feedback owner",
      email: `${userId}@example.test`,
      emailVerified: true,
    },
    {
      id: otherUserId,
      name: "message feedback stranger",
      email: `${otherUserId}@example.test`,
      emailVerified: true,
    },
  ])
  await db.insert(branchTrees).values({ id: treeId, userId, state: state() })
  await startGeneration({
    userId,
    treeId,
    threadId: "main",
    userMessageId: "u1",
    assistantMessageId: "a1",
    generationId,
    modelId: "glm-5.2",
    intent: { kind: "persisted-turn" },
  })

  assert.deepEqual(
    await setMessageFeedbackForOwner({
      userId,
      treeId,
      threadId: "main",
      messageId: "a1",
      feedback: "positive",
    }),
    { ok: false, reason: "not_completed" }
  )

  await finalizeGeneration({
    generationId,
    outcome: "completed",
    result,
    usageUnavailable: true,
  })
  await db
    .update(branchTrees)
    .set({ state: state("done") })
    .where(eq(branchTrees.id, treeId))

  const positive = await setMessageFeedbackForOwner({
    userId,
    treeId,
    threadId: "main",
    messageId: "a1",
    feedback: "positive",
  })
  assert.equal(positive.ok, true)
  assert.equal(positive.feedback.feedback, "positive")
  const firstUpdatedAt = positive.feedback.updatedAt

  const repeated = await setMessageFeedbackForOwner({
    userId,
    treeId,
    threadId: "main",
    messageId: "a1",
    feedback: "positive",
  })
  assert.equal(repeated.feedback.updatedAt, firstUpdatedAt)

  const negative = await setMessageFeedbackForOwner({
    userId,
    treeId,
    threadId: "main",
    messageId: "a1",
    feedback: "negative",
  })
  assert.equal(negative.feedback.messageId, "a1")
  assert.equal(negative.feedback.feedback, "negative")
  assert.equal((await listMessageFeedbackForTree(userId, treeId)).length, 1)

  assert.deepEqual(
    await setMessageFeedbackForOwner({
      userId: otherUserId,
      treeId,
      threadId: "main",
      messageId: "a1",
      feedback: "positive",
    }),
    { ok: false, reason: "not_found" }
  )

  const cleared = await setMessageFeedbackForOwner({
    userId,
    treeId,
    threadId: "main",
    messageId: "a1",
    feedback: null,
  })
  assert.deepEqual(cleared, { ok: true, feedback: null })
  assert.deepEqual(await listMessageFeedbackForTree(userId, treeId), [])

  console.log(
    "PASS  message-scoped feedback set/repeat/switch/clear and owner isolation"
  )
}

try {
  await run()
} finally {
  await db.delete(user).where(eq(user.id, userId))
  await db.delete(user).where(eq(user.id, otherUserId))
}
