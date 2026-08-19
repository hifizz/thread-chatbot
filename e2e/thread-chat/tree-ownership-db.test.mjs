/**
 * Legacy null-owner claim:
 *   node --env-file=.env.local --import tsx e2e/thread-chat/tree-ownership-db.test.mjs
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { branchTrees, user } from "../../lib/db/schema.ts"
import { loadOwnedOrClaimLegacyTree } from "../../lib/thread-chat-generation/tree-repository.ts"

const suffix = randomUUID()
const claimantIds = [
  `tree-claimant-a-${suffix}`,
  `tree-claimant-b-${suffix}`,
]
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
  await db.insert(user).values(
    claimantIds.map((id, index) => ({
      id,
      name: `tree claimant ${index}`,
      email: `${id}@example.test`,
      emailVerified: true,
    }))
  )
  await db.insert(branchTrees).values({ id: treeId, userId: null, state })

  const claims = await Promise.all(
    claimantIds.map((userId) =>
      loadOwnedOrClaimLegacyTree({ userId, treeId })
    )
  )
  assert.equal(
    claims.filter(Boolean).length,
    1,
    "only one concurrent exact-URL visitor may claim the legacy tree"
  )

  const winnerIndex = claims.findIndex(Boolean)
  const winnerId = claimantIds[winnerIndex]
  const loserId = claimantIds[1 - winnerIndex]
  const [persisted] = await db
    .select({ userId: branchTrees.userId })
    .from(branchTrees)
    .where(eq(branchTrees.id, treeId))
  assert.equal(persisted.userId, winnerId)
  assert.ok(await loadOwnedOrClaimLegacyTree({ userId: winnerId, treeId }))
  assert.equal(
    await loadOwnedOrClaimLegacyTree({ userId: loserId, treeId }),
    null,
    "a claimed tree must never transfer to a second user"
  )

  console.log(
    "PASS  legacy tree exact-URL claim is atomic, sticky, and owner-isolated"
  )
}

try {
  await run()
} finally {
  await db.delete(branchTrees).where(eq(branchTrees.id, treeId))
  await db.delete(user).where(inArray(user.id, claimantIds))
}
