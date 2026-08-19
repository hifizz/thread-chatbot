/**
 * Atomic tree deletion and generation-start race:
 *   node --env-file=.env.local --import tsx e2e/thread-chat/tree-deletion-db.test.mjs
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { branchGenerations, branchTrees, user } from "../../lib/db/schema.ts"
import {
  GenerationRepositoryError,
  prepareGeneration,
} from "../../lib/thread-chat-generation/start-generation-repository.ts"
import { deleteOwnedTreeIfIdle } from "../../lib/thread-chat-generation/tree-repository.ts"

const suffix = randomUUID()
const userId = `tree-deletion-${suffix}`
const treeId = randomUUID()
const generationId = randomUUID()

const state = {
  schemaVersion: 2,
  threads: {
    main: {
      id: "main",
      modelId: "glm-5.3",
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
          text: "并发删除测试",
          forks: [],
        },
        {
          id: "a1",
          parentMessageId: "u1",
          role: "assistant",
          text: "",
          forks: [],
          generationId,
          status: "pending",
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
  seq: 2,
  tick: 1,
}

async function run() {
  await db.insert(user).values({
    id: userId,
    name: "tree deletion test",
    email: `${userId}@example.test`,
    emailVerified: true,
  })
  await db.insert(branchTrees).values({ id: treeId, userId, state })

  const [deleteAttempt, startAttempt] = await Promise.allSettled([
    deleteOwnedTreeIfIdle({ userId, treeId }),
    prepareGeneration({
      userId,
      treeId,
      threadId: "main",
      modelId: "glm-5.3",
      userMessageId: "u1",
      assistantMessageId: "a1",
      generationId,
      intent: { kind: "persisted-turn" },
    }),
  ])

  assert.equal(deleteAttempt.status, "fulfilled")
  if (deleteAttempt.value === "deleted") {
    assert.equal(startAttempt.status, "rejected")
    assert.ok(startAttempt.reason instanceof GenerationRepositoryError)
    assert.equal(startAttempt.reason.code, "not_found")
  } else {
    assert.equal(deleteAttempt.value, "generation_running")
    assert.equal(startAttempt.status, "fulfilled")
    assert.equal(startAttempt.value.created, true)

    await db
      .update(branchGenerations)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(branchGenerations.id, generationId))
    assert.equal(
      await deleteOwnedTreeIfIdle({ userId, treeId }),
      "deleted"
    )
  }

  assert.equal(
    await deleteOwnedTreeIfIdle({ userId, treeId }),
    "not_found",
    "repeated deletion must remain idempotent"
  )
  assert.equal(
    (await db.select().from(branchTrees).where(eq(branchTrees.id, treeId)))
      .length,
    0
  )

  console.log(
    "PASS  tree deletion serializes with generation start and remains idempotent"
  )
}

try {
  await run()
} finally {
  await db.delete(user).where(eq(user.id, userId))
}
