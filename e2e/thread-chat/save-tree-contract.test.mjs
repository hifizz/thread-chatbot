import assert from "node:assert/strict"
import {
  SAVE_TREE_ERROR_STATUS,
  saveTreeErrorResponseSchema,
  saveTreeRequestSchema,
  saveTreeSuccessResponseSchema,
} from "../../lib/thread-chat/contracts/save-tree.ts"
import {
  readSaveTreeRevision,
  TreeRevisionError,
} from "../../app/thread-chat/net/persistence/save-tree-response.ts"

assert.equal(
  saveTreeRequestSchema.safeParse({
    state: { schemaVersion: 2 },
    title: null,
    baseRevision: 0,
  }).success,
  true
)
for (const baseRevision of [-1, 1.5, "1", undefined]) {
  assert.equal(
    saveTreeRequestSchema.safeParse({
      state: { schemaVersion: 2 },
      baseRevision,
    }).success,
    false
  )
}

assert.equal(
  saveTreeSuccessResponseSchema.safeParse({ ok: true, revision: 2 }).success,
  true
)
assert.equal(
  saveTreeErrorResponseSchema.safeParse({
    error: {
      code: "tree_revision_conflict",
      message: "该对话已在其他页面更新",
      currentRevision: 2,
    },
  }).success,
  true
)
assert.equal(SAVE_TREE_ERROR_STATUS.revision_required, 428)

assert.equal(
  await readSaveTreeRevision(Response.json({ ok: true, revision: 2 })),
  2
)
assert.equal(await readSaveTreeRevision(Response.json({ ok: true })), null)

await assert.rejects(
  () =>
    readSaveTreeRevision(
      Response.json(
        {
          error: {
            code: "tree_revision_conflict",
            message: "该对话已在其他页面更新",
            currentRevision: 3,
          },
        },
        { status: 409 }
      )
    ),
  (error) =>
    error instanceof TreeRevisionError &&
    error.code === "tree_revision_conflict" &&
    error.currentRevision === 3
)

console.log(
  "PASS  save tree contract composes CAS revision and the client response interpreter"
)
