import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  COL_MIN_W,
  columnCountForWidth,
} from "../../app/thread-chat/orchestration/columns/use-column-viewport.ts"

await test("column capacity keeps the existing SSR and 2-4 column bounds", () => {
  assert.equal(COL_MIN_W, 430)
  assert.equal(columnCountForWidth(null), 3)
  assert.equal(columnCountForWidth(0), 2)
  assert.equal(columnCountForWidth(859), 2)
  assert.equal(columnCountForWidth(1_290), 3)
  assert.equal(columnCountForWidth(10_000), 4)
})

await test("column view no longer owns viewport subscriptions", async () => {
  const [columns, viewport, workspace] = await Promise.all([
    readFile(
      new URL(
        "../../app/thread-chat/orchestration/columns/thread-columns.tsx",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../../app/thread-chat/orchestration/columns/use-column-viewport.ts",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../../app/thread-chat/orchestration/workspace/use-thread-chat-workspace.ts",
        import.meta.url
      ),
      "utf8"
    ),
  ])

  assert.doesNotMatch(
    columns,
    /useSyncExternalStore|addEventListener\("resize"/
  )
  assert.match(viewport, /useSyncExternalStore/)
  assert.match(workspace, /useColumnViewport\(\)/)
})
