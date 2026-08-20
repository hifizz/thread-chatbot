import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { dialogCloseToShell } from "../../app/thread-chat/orchestration/dialog-close-to-shell.ts"

const details = (reason) => {
  const calls = []
  return {
    calls,
    event: {
      reason,
      cancel: () => calls.push("cancel"),
      allowPropagation: () => calls.push("propagate"),
    },
  }
}

await test("open transitions never notify the shell", () => {
  let closes = 0
  const change = dialogCloseToShell(() => closes++)
  const input = details("trigger-press")

  change(true, input.event)

  assert.equal(closes, 0)
  assert.deepEqual(input.calls, [])
})

await test("Escape stays in the shell priority chain", () => {
  let closes = 0
  const change = dialogCloseToShell(() => closes++)
  const input = details("escape-key")

  change(false, input.event)

  assert.equal(closes, 0)
  assert.deepEqual(input.calls, ["cancel", "propagate"])
})

await test("non-Escape close reasons notify the shell once", () => {
  let closes = 0
  const change = dialogCloseToShell(() => closes++)
  const input = details("outside-press")

  change(false, input.event)

  assert.equal(closes, 1)
  assert.deepEqual(input.calls, [])
})

await test("all Dialog consumers import the shared bridge", async () => {
  const sources = await Promise.all(
    ["thread-switcher.tsx", "tree-list.tsx", "help-panel.tsx"].map((file) =>
      readFile(
        new URL(`../../app/thread-chat/orchestration/${file}`, import.meta.url),
        "utf8"
      )
    )
  )

  for (const source of sources)
    assert.match(source, /from "\.\/dialog-close-to-shell"/)
})
