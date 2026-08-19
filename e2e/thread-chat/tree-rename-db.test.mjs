/**
 * Owner-scoped tree rename:
 *   node --env-file=.env.local --import tsx e2e/thread-chat/tree-rename-db.test.mjs
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { branchTrees, user } from "../../lib/db/schema.ts"
import { renameOwnedTree } from "../../lib/thread-chat-generation/tree-repository.ts"

const suffix = randomUUID()
const ownerId = `tree-rename-owner-${suffix}`
const strangerId = `tree-rename-stranger-${suffix}`
const treeId = randomUUID()

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

async function run() {
  await db.insert(user).values([
    {
      id: ownerId,
      name: "tree rename owner",
      email: `${ownerId}@example.test`,
      emailVerified: true,
    },
    {
      id: strangerId,
      name: "tree rename stranger",
      email: `${strangerId}@example.test`,
      emailVerified: true,
    },
  ])
  await db.insert(branchTrees).values({
    id: treeId,
    userId: ownerId,
    title: "Derived title",
    state,
  })

  assert.equal(
    await renameOwnedTree({
      userId: strangerId,
      treeId,
      customTitle: "Hijacked",
    }),
    false
  )
  assert.equal(
    await renameOwnedTree({
      userId: ownerId,
      treeId,
      customTitle: "My research",
    }),
    true
  )
  assert.equal(
    await renameOwnedTree({
      userId: ownerId,
      treeId: randomUUID(),
      customTitle: "Missing",
    }),
    false
  )

  const [persisted] = await db
    .select({
      title: branchTrees.title,
      customTitle: branchTrees.customTitle,
    })
    .from(branchTrees)
    .where(eq(branchTrees.id, treeId))
  assert.equal(persisted.title, "Derived title")
  assert.equal(persisted.customTitle, "My research")

  console.log("PASS  tree rename is owner-scoped and preserves derived title")
}

try {
  await run()
} finally {
  await db.delete(branchTrees).where(eq(branchTrees.id, treeId))
  await db.delete(user).where(inArray(user.id, [ownerId, strangerId]))
}
