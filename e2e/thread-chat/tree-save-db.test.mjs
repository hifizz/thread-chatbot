/**
 * Owner-scoped tree CAS upsert:
 *   node --env-file=.env.local --import tsx e2e/thread-chat/tree-save-db.test.mjs
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { branchTrees, user } from "../../lib/db/schema.ts"
import { saveOwnedTree } from "../../lib/thread-chat-generation/tree-repository.ts"

const suffix = randomUUID()
const ownerId = `tree-save-owner-${suffix}`
const strangerId = `tree-save-stranger-${suffix}`
const treeId = randomUUID()

function state(title) {
  return {
    schemaVersion: 2,
    threads: {
      main: {
        id: "main",
        modelId: "glm-5.3",
        parentId: null,
        depth: 0,
        title,
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages: [],
        activeLeafMessageId: null,
        lastActive: 1,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 0,
    tick: 1,
  }
}

async function run() {
  await db.insert(user).values([
    {
      id: ownerId,
      name: "tree save owner",
      email: `${ownerId}@example.test`,
      emailVerified: true,
    },
    {
      id: strangerId,
      name: "tree save stranger",
      email: `${strangerId}@example.test`,
      emailVerified: true,
    },
  ])

  assert.deepEqual(
    await saveOwnedTree({
      userId: ownerId,
      treeId,
      state: state("first"),
      title: "First",
      baseRevision: 0,
    }),
    { kind: "saved", revision: 1 }
  )
  assert.deepEqual(
    await saveOwnedTree({
      userId: ownerId,
      treeId,
      state: state("stale"),
      title: "Stale",
      baseRevision: 0,
    }),
    { kind: "conflict", revision: 1 }
  )
  assert.deepEqual(
    await saveOwnedTree({
      userId: strangerId,
      treeId,
      state: state("stranger"),
      title: "Stranger",
      baseRevision: 1,
    }),
    { kind: "not_found" }
  )
  assert.deepEqual(
    await saveOwnedTree({
      userId: ownerId,
      treeId,
      state: state("second"),
      title: "Second",
      baseRevision: 1,
    }),
    { kind: "saved", revision: 2 }
  )

  const [persisted] = await db
    .select({
      userId: branchTrees.userId,
      revision: branchTrees.revision,
      title: branchTrees.title,
      state: branchTrees.state,
    })
    .from(branchTrees)
    .where(eq(branchTrees.id, treeId))
  assert.equal(persisted.userId, ownerId)
  assert.equal(persisted.revision, 2)
  assert.equal(persisted.title, "Second")
  assert.equal(persisted.state.threads.main.title, "second")

  console.log("PASS  tree save owns create, revision CAS, and owner isolation")
}

try {
  await run()
} finally {
  await db.delete(branchTrees).where(eq(branchTrees.id, treeId))
  await db.delete(user).where(inArray(user.id, [ownerId, strangerId]))
}
