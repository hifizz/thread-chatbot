import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { canvasLayoutPositions } from "../../app/thread-chat/orchestration/canvas/canvas-layout.ts"

const spec = (childHeight = 120) => ({
  nodes: [
    { id: "main", width: 280, height: 140 },
    { id: "child", width: 280, height: childHeight },
  ],
  edges: [{ source: "main", target: "child" }],
})

await test("semantically equal layout inputs reuse the Dagre result", () => {
  const first = canvasLayoutPositions(spec())
  const second = canvasLayoutPositions(spec())

  assert.equal(second, first)
  assert.ok(first.get("child").x > first.get("main").x)
})

await test("a node dimension change produces a new layout result", () => {
  const before = canvasLayoutPositions(spec())
  const after = canvasLayoutPositions(spec(180))

  assert.notEqual(after, before)
  assert.notDeepEqual(after.get("child"), before.get("child"))
})

await test("the React hook delegates Dagre ownership to the layout module", async () => {
  const hook = await readFile(
    new URL(
      "../../app/thread-chat/orchestration/canvas/use-canvas-layout.ts",
      import.meta.url
    ),
    "utf8"
  )
  const layout = await readFile(
    new URL(
      "../../app/thread-chat/orchestration/canvas/canvas-layout.ts",
      import.meta.url
    ),
    "utf8"
  )

  assert.match(hook, /canvasLayoutPositions\(/)
  assert.doesNotMatch(hook, /@dagrejs\/dagre/)
  assert.match(layout, /MAX_LAYOUT_CACHE_ENTRIES = 32/)
  assert.match(layout, /dagreLayout\(graph\)/)
})
