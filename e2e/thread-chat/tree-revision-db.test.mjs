/**
 * Revision-controlled message graph commands:
 *   node --import tsx e2e/thread-chat/tree-revision-db.test.mjs
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { branchTrees, user } from "../../lib/db/schema.ts"
import { prepareGeneration } from "../../lib/thread-chat-generation/repository.ts"
import {
  switchActiveLeafForOwner,
  TreeCommandError,
} from "../../lib/thread-chat-generation/tree-repository.ts"

const suffix = randomUUID()
const ownerId = `tree-revision-owner-${suffix}`
const strangerId = `tree-revision-stranger-${suffix}`
const treeId = randomUUID()

const state = {
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
          text: "版本 A",
          forks: [],
          status: "done",
        },
        {
          id: "a2",
          parentMessageId: "u1",
          role: "assistant",
          text: "版本 B",
          forks: [],
          status: "done",
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

async function expectTreeError(promise, code, currentRevision) {
  await assert.rejects(
    promise,
    (error) =>
      error instanceof TreeCommandError &&
      error.code === code &&
      (currentRevision === undefined ||
        error.currentRevision === currentRevision)
  )
}

async function run() {
  await db.insert(user).values([
    {
      id: ownerId,
      name: "tree revision owner",
      email: `${ownerId}@example.test`,
      emailVerified: true,
    },
    {
      id: strangerId,
      name: "tree revision stranger",
      email: `${strangerId}@example.test`,
      emailVerified: true,
    },
  ])
  await db.insert(branchTrees).values({
    id: treeId,
    userId: ownerId,
    state,
    revision: 0,
  })

  const switched = await switchActiveLeafForOwner({
    userId: ownerId,
    treeId,
    threadId: "main",
    assistantMessageId: "a2",
    baseRevision: 0,
  })
  assert.equal(switched.revision, 1)
  assert.equal(switched.thread.activeLeafMessageId, "a2")

  await expectTreeError(
    switchActiveLeafForOwner({
      userId: ownerId,
      treeId,
      threadId: "main",
      assistantMessageId: "a1",
      baseRevision: 0,
    }),
    "tree_revision_conflict",
    1
  )
  await expectTreeError(
    switchActiveLeafForOwner({
      userId: strangerId,
      treeId,
      threadId: "main",
      assistantMessageId: "a1",
      baseRevision: 1,
    }),
    "not_found"
  )
  await expectTreeError(
    switchActiveLeafForOwner({
      userId: ownerId,
      treeId,
      threadId: "main",
      assistantMessageId: "missing",
      baseRevision: 1,
    }),
    "invalid_turn"
  )

  const generationId = randomUUID()
  const prepared = await prepareGeneration({
    userId: ownerId,
    treeId,
    threadId: "main",
    modelId: "glm-5.2",
    userMessageId: "u1",
    assistantMessageId: "a3",
    generationId,
    intent: {
      kind: "regenerate-assistant",
      sourceAssistantMessageId: "a2",
    },
  })
  assert.equal(prepared.revision, 2)

  await expectTreeError(
    switchActiveLeafForOwner({
      userId: ownerId,
      treeId,
      threadId: "main",
      assistantMessageId: "a1",
      baseRevision: 1,
    }),
    "tree_revision_conflict",
    2
  )

  const [persisted] = await db
    .select({ state: branchTrees.state, revision: branchTrees.revision })
    .from(branchTrees)
    .where(eq(branchTrees.id, treeId))
  assert.equal(persisted.revision, 2)
  assert.equal(persisted.state.threads.main.activeLeafMessageId, "a3")
  assert.equal(
    persisted.state.threads.main.messages.filter(
      (message) => message.id === "a3"
    ).length,
    1
  )

  console.log(
    "PASS  active-leaf CAS, stale/unauthorized rejection and generation race"
  )
}

try {
  await run()
} finally {
  await db.delete(user).where(eq(user.id, ownerId))
  await db.delete(user).where(eq(user.id, strangerId))
}
