import assert from "node:assert/strict"
import { createModels } from "../../lib/ai/llm/create-models.ts"

let providerCreations = 0
const modelCreations = []
const provider = createModels({
  models: {
    id: "demo",
    name: "Demo",
    defaults: { surfaces: ["thread"] },
    models: [{ id: "model-a" }, { id: "model-b" }],
  },
  isConfigured: () => true,
  createProvider() {
    providerCreations += 1
    return (model) => {
      modelCreations.push(model.id)
      return { modelId: model.id }
    }
  },
})

assert.equal(providerCreations, 0)
assert.equal(provider.routes[0].route.createModel().modelId, "model-a")
assert.equal(provider.routes[1].route.createModel().modelId, "model-b")
assert.equal(provider.routes[0].route.createModel().modelId, "model-a")
assert.equal(providerCreations, 1)
assert.deepEqual(modelCreations, ["model-a", "model-b", "model-a"])
console.log("PASS  createModels 对所有模型复用同一个 provider")
