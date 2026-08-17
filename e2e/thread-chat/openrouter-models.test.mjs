import assert from "node:assert/strict"
import {
  CHAT_MODELS,
  OPENROUTER_MODEL_IDS,
  THREAD_CHAT_MODELS,
} from "../../constants/model.ts"
import {
  MODEL_COST,
  priceFromCost,
  usdToMicros,
} from "../../constants/pricing.ts"
import { openRouterCostUsdFromSteps } from "../../lib/ai/openrouter.ts"

const expectedSlugs = [
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-luna-pro",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-terra-pro",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-sol-pro",
  "openai/gpt-5.5",
  "openai/gpt-5.5-pro",
  "moonshotai/kimi-k3",
  "deepseek/deepseek-v4-flash-0731",
  "qwen/qwen3.8-max",
  "x-ai/grok-4.5",
  "x-ai/grok-4.6",
]
const models = CHAT_MODELS.filter((model) => model.provider === "openrouter")
assert.equal(models.length, 13)
assert.deepEqual([...OPENROUTER_MODEL_IDS], expectedSlugs)
assert.deepEqual(
  models.map((model) => model.upstreamModel),
  expectedSlugs
)
assert.equal(
  new Set(CHAT_MODELS.map((model) => model.id)).size,
  CHAT_MODELS.length
)
assert.ok(models.every((model) => model.id.startsWith("openrouter-")))
assert.ok(models.every((model) => model.name.startsWith("OpenRouter · ")))
assert.ok(models.every((model) => model.reasoningTransport === "native"))
assert.ok(models.every((model) => THREAD_CHAT_MODELS.includes(model)))
assert.notEqual(
  CHAT_MODELS.find((model) => model.id === "deepseek-v4-flash")?.provider,
  models.find((model) => model.id === "openrouter-deepseek-v4-flash-0731")
    ?.provider
)
assert.ok(models.every((model) => MODEL_COST[model.id]?.inputPerMillion > 0))
assert.ok(models.every((model) => MODEL_COST[model.id]?.outputPerMillion > 0))
assert.deepEqual(
  Object.fromEntries(
    [
      "openrouter-qwen3.8-max",
      "openrouter-grok-4.5",
      "openrouter-grok-4.6",
    ].map((id) => {
      const cost = MODEL_COST[id]
      return [id, [cost?.inputPerMillion, cost?.outputPerMillion]]
    })
  ),
  {
    "openrouter-qwen3.8-max": [2, 6],
    "openrouter-grok-4.5": [4, 12],
    "openrouter-grok-4.6": [4, 12],
  }
)
assert.ok(!models.some((model) => model.upstreamModel.includes("glm-5.3")))

const step = (cost) => ({
  providerMetadata: { openrouter: { usage: { cost } } },
})
assert.equal(openRouterCostUsdFromSteps([step(0.25)]), 0.25)
assert.equal(openRouterCostUsdFromSteps([step(0), step(0.2), step(0.3)]), 0.5)
for (const steps of [
  [],
  [step(0.1), {}],
  [step(-1)],
  [step("1")],
  [step(NaN)],
  [step(Infinity)],
]) {
  assert.equal(openRouterCostUsdFromSteps(steps), null)
}
const cost = usdToMicros(1)
const price = priceFromCost(cost)
assert.ok((price - cost) / price >= 0.3)
console.log("PASS  OpenRouter 注册表、可见性、保守价与逐 step 成本校验")
