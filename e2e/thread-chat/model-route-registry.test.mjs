import assert from "node:assert/strict"
import { CHAT_MODELS, isChatModelId } from "../../constants/model.ts"
import { THREAD_CHAT_MODEL_OPTIONS } from "../../constants/client-model.ts"
import {
  getModelRouteProvider,
  resolveChatModel,
} from "../../lib/ai/llm/model-routes.ts"
import {
  isIcelandRelayConfigured,
  normalizeIcelandRelayBaseURL,
} from "../../lib/ai/llm/iceland-relay.ts"

assert.equal(new Set(CHAT_MODELS.map((model) => model.id)).size, CHAT_MODELS.length)
assert.ok(THREAD_CHAT_MODEL_OPTIONS.length > 0)

for (const option of THREAD_CHAT_MODEL_OPTIONS) {
  assert.ok(isChatModelId(option.id), `unknown public model ${option.id}`)
  assert.equal("provider" in option, false)
  assert.equal("upstreamModel" in option, false)
  assert.equal("gatewayModel" in option, false)
  assert.ok(option.groupId)
  assert.ok(option.groupName)
  assert.ok(getModelRouteProvider(option.id))
}

const icelandModels = CHAT_MODELS.filter(
  (model) => model.provider === "iceland-relay"
)
const icelandOptions = THREAD_CHAT_MODEL_OPTIONS.filter(
  (model) => model.groupName === "冰岛"
)
assert.equal(icelandModels.length, 16)
assert.equal(icelandOptions.length, 16)
assert.ok(
  icelandModels.every(
    (model) =>
      model.icelandProtocol === "anthropic" ||
      model.icelandProtocol === "openai"
  )
)
assert.equal(
  normalizeIcelandRelayBaseURL("https://relay.example.test"),
  "https://relay.example.test/v1"
)

const originalBaseURL = process.env.ICELAND_RELAY_BASE_URL
const originalApiKey = process.env.ICELAND_RELAY_API_KEY
try {
  process.env.ICELAND_RELAY_BASE_URL = "https://relay.example.test"
  process.env.ICELAND_RELAY_API_KEY = "test-api-key"
  assert.equal(isIcelandRelayConfigured(), true)
  delete process.env.ICELAND_RELAY_API_KEY
  assert.equal(isIcelandRelayConfigured(), false)
} finally {
  if (originalBaseURL === undefined) delete process.env.ICELAND_RELAY_BASE_URL
  else process.env.ICELAND_RELAY_BASE_URL = originalBaseURL
  if (originalApiKey === undefined) delete process.env.ICELAND_RELAY_API_KEY
  else process.env.ICELAND_RELAY_API_KEY = originalApiKey
}

assert.throws(() => resolveChatModel("legacy-provider-model"), /未知模型/)
assert.throws(() => resolveChatModel("not-registered"), /未知模型/)

console.log("PASS  model routes, public fields, Iceland relay, and unknown model rejection")
