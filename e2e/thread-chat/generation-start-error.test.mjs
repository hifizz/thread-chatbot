import assert from "node:assert/strict"
import { generationStartErrorResponse } from "../../app/api/chat/generation-start-error.ts"
import { GenerationRepositoryError } from "../../lib/thread-chat-generation/start-generation-repository.ts"

for (const [code, status] of [
  ["not_found", 404],
  ["generation_conflict", 409],
  ["model_mismatch", 409],
  ["invalid_turn", 409],
  ["not_latest_turn", 409],
  ["persistence_failed", 503],
]) {
  const response = generationStartErrorResponse(
    new GenerationRepositoryError(code, `message:${code}`)
  )
  assert.equal(response.status, status)
  assert.deepEqual(await response.json(), {
    error: { code, message: `message:${code}` },
  })
}

const originalError = console.error
console.error = () => {}
try {
  const response = generationStartErrorResponse(new Error("database down"))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: {
      code: "persistence_failed",
      message: "无法建立生成任务，尚未调用模型",
    },
  })
} finally {
  console.error = originalError
}

console.log(
  "PASS  generation start errors map repository and unknown failures to stable HTTP responses"
)
