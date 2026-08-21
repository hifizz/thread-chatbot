import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { dialogCloseToShell } from "../../app/thread-chat/orchestration/overlays/dialog-close-to-shell.ts"

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
  const consumers = [
    {
      path: "../../app/thread-chat/orchestration/navigation/thread-switcher.tsx",
      importPattern: /from "\.\.\/overlays\/dialog-close-to-shell"/,
    },
    {
      path: "../../app/thread-chat/orchestration/navigation/tree-list.tsx",
      importPattern: /from "\.\.\/overlays\/dialog-close-to-shell"/,
    },
    {
      path: "../../app/thread-chat/orchestration/overlays/help-panel.tsx",
      importPattern: /from "\.\/dialog-close-to-shell"/,
    },
  ]

  for (const consumer of consumers) {
    const source = await readFile(new URL(consumer.path, import.meta.url), "utf8")
    assert.match(source, consumer.importPattern)
  }
})
