import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { createLocalGenerationExecutions } from "../../app/thread-chat/net/stream/local-generation-executions.ts"

await test("local generation registry tracks ownership and active generation ids", () => {
  const executions = createLocalGenerationExecutions()
  const first = executions.begin("main", "generation-1")

  assert.equal(executions.hasThread("main"), true)
  assert.equal(executions.isGenerationActive("generation-1"), true)
  assert.equal(executions.isGenerationActive("generation-2"), false)
  assert.equal(first.isOwner(), true)

  const replacement = executions.begin("main", "generation-2")
  assert.equal(first.isOwner(), false)
  assert.equal(replacement.isOwner(), true)
  assert.equal(executions.isGenerationActive("generation-1"), false)
  assert.equal(executions.isGenerationActive("generation-2"), true)

  executions.clearIfOwner("main", first.controller)
  assert.equal(
    replacement.isOwner(),
    true,
    "stale cleanup must preserve new flow"
  )
  executions.clearIfOwner("main", replacement.controller)
  assert.equal(executions.hasThread("main"), false)
})

await test("detach aborts one thread and detachAll aborts every local stream", () => {
  const executions = createLocalGenerationExecutions()
  const main = executions.begin("main", "generation-main")
  const branch = executions.begin("branch", "generation-branch")

  executions.detach("main")
  assert.equal(main.controller.signal.aborted, true)
  assert.equal(branch.controller.signal.aborted, false)

  executions.detachAll()
  assert.equal(branch.controller.signal.aborted, true)
})

await test("reconciliation skips only generations with a local SSE owner", async () => {
  const [hook, runtime, controller] = await Promise.all([
    readFile(
      new URL(
        "../../app/thread-chat/generation/use-generation-reconciliation.ts",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../../app/thread-chat/orchestration/workspace/use-thread-chat-runtime.ts",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL("../../app/thread-chat/net/chat-controller.ts", import.meta.url),
      "utf8"
    ),
  ])

  assert.match(
    hook,
    /if \(isGenerationStreamingLocally\(generationId\)\) continue/
  )
  assert.match(runtime, /chat\.isGenerationStreamingLocally/)
  assert.match(
    controller,
    /isGenerationStreamingLocally\(generationId: string\)/
  )
})
