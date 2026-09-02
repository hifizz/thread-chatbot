import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { messagesByIdOrder } from "../../app/thread-chat/core/selectors.ts"

const message = (id, text = id) => ({
  id,
  parentMessageId: null,
  role: "user",
  text,
  forks: [],
})

await test("message id selector preserves requested order and filters missing ids", () => {
  const firstDuplicate = message("duplicate", "first")
  const messages = [
    message("a"),
    firstDuplicate,
    message("b"),
    message("duplicate", "second"),
  ]

  assert.deepEqual(
    messagesByIdOrder(messages, ["b", "missing", "duplicate", "a"]),
    [messages[2], firstDuplicate, messages[0]]
  )
})

await test("message id selector scales across a large reversed active path", () => {
  const count = 20_000
  const messages = Array.from({ length: count }, (_, index) =>
    message(`message-${index}`)
  )
  const requestedIds = Array.from(
    { length: count },
    (_, index) => `message-${count - index - 1}`
  )

  const selected = messagesByIdOrder(messages, requestedIds)

  assert.equal(selected.length, count)
  assert.equal(selected[0], messages[count - 1])
  assert.equal(selected[count - 1], messages[0])
})

await test("column and canvas views consume the shared message id selector", async () => {
  const [column, canvas] = await Promise.all([
    readFile(
      new URL(
        "../../app/thread-chat/branching/branchable-chat.tsx",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../../app/thread-chat/orchestration/canvas/use-canvas-layout.ts",
        import.meta.url
      ),
      "utf8"
    ),
  ])

  for (const consumer of [column, canvas]) {
    assert.match(consumer, /messagesByIdOrder\(/)
    assert.doesNotMatch(consumer, /messages\.find\(/)
  }
})
