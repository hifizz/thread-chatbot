import assert from "node:assert/strict"
import { CHAT_MODELS } from "../../constants/model.ts"
import { MODEL_COST, costMicros } from "../../constants/pricing.ts"

const billableModels = CHAT_MODELS.filter(
  (model) => model.unbilledPreview !== true
)
const billableIds = new Set(billableModels.map((model) => model.id))

for (const model of billableModels) {
  assert.ok(MODEL_COST[model.id], `missing price for ${model.id}`)
  assert.ok(costMicros(model.id, 1_000, 1_000) > 0)
}

for (const modelId of Object.keys(MODEL_COST)) {
  assert.ok(billableIds.has(modelId), `orphan price for ${modelId}`)
}

const arkModels = CHAT_MODELS.filter((model) => model.provider === "ark")
assert.ok(arkModels.length > 0)
for (const model of arkModels) {
  assert.deepEqual(MODEL_COST[model.id], MODEL_COST[arkModels[0].id])
}

console.log(
  "PASS  billable model prices cover the registry without orphan keys and Ark entries share one policy"
)
