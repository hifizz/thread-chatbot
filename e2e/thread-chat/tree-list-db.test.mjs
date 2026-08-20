/**
 * Owner-scoped tree list projection:
 *   node --env-file=.env.local --import tsx e2e/thread-chat/tree-list-db.test.mjs
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { inArray } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { branchTrees, user } from "../../lib/db/schema.ts"
import { listOwnedTreeSummaries } from "../../lib/thread-chat-generation/tree-repository.ts"

const suffix = randomUUID()
const ownerId = `tree-list-owner-${suffix}`
const strangerId = `tree-list-stranger-${suffix}`
const treeIds = [randomUUID(), randomUUID(), randomUUID()]

const stateWithThreads = (threads) => ({ schemaVersion: 2, threads })

async function run() {
  await db.insert(user).values([
    {
      id: ownerId,
      name: "tree list owner",
      email: `${ownerId}@example.test`,
      emailVerified: true,
    },
    {
      id: strangerId,
      name: "tree list stranger",
      email: `${strangerId}@example.test`,
      emailVerified: true,
    },
  ])

  const older = new Date("2026-01-01T00:00:00.000Z")
  const newer = new Date("2026-01-02T00:00:00.000Z")
  await db.insert(branchTrees).values([
    {
      id: treeIds[0],
      userId: ownerId,
      title: "Derived title",
      customTitle: "Custom title",
      state: stateWithThreads({ main: {}, child: {} }),
      updatedAt: older,
    },
    {
      id: treeIds[1],
      userId: ownerId,
      title: null,
      customTitle: null,
      state: stateWithThreads([]),
      updatedAt: newer,
    },
    {
      id: treeIds[2],
      userId: strangerId,
      title: "Private stranger tree",
      state: stateWithThreads({ main: {} }),
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    },
  ])

  const rows = await listOwnedTreeSummaries(ownerId)

  assert.deepEqual(
    rows.map(({ id, title, threadCount }) => ({ id, title, threadCount })),
    [
      { id: treeIds[1], title: "未命名对话", threadCount: 0 },
      { id: treeIds[0], title: "Custom title", threadCount: 2 },
    ]
  )
  assert.deepEqual(
    rows.map(({ updatedAt }) => updatedAt.toISOString()),
    [newer.toISOString(), older.toISOString()]
  )

  console.log(
    "PASS  tree list preserves owner isolation, title fallback, poison-row defense, count, and ordering"
  )
}

try {
  await run()
} finally {
  await db.delete(branchTrees).where(inArray(branchTrees.id, treeIds))
  await db.delete(user).where(inArray(user.id, [ownerId, strangerId]))
}
