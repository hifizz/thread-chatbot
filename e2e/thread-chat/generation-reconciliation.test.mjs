import assert from "node:assert/strict"
import {
  initialGenerationIds,
  isGenerationInFlight,
  messageGenerationIds,
} from "../../app/thread-chat/generation/generation-reconciliation-logic.ts"

assert.equal(isGenerationInFlight("running"), true)
assert.equal(isGenerationInFlight("stop_requested"), true)
assert.equal(isGenerationInFlight("completed"), false)
assert.deepEqual(
  [
    ...initialGenerationIds([
      { id: "running", status: "running" },
      { id: "stopping", status: "stop_requested" },
      { id: "done", status: "completed" },
    ]),
  ],
  ["running", "stopping"]
)

assert.deepEqual(
  messageGenerationIds({
    threads: {
      main: {
        messages: [
          {
            role: "assistant",
            status: "pending",
            generationId: "pending",
          },
          {
            role: "assistant",
            status: "streaming",
            generationId: "streaming",
          },
          {
            role: "assistant",
            status: "done",
            generationId: "done",
          },
          { role: "user", status: "pending", generationId: "user" },
          { role: "assistant", status: "pending" },
        ],
      },
    },
  }),
  ["pending", "streaming"]
)

console.log(
  "PASS  generation reconciliation tracks only server/message work still in flight"
)
