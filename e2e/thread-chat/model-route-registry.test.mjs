import assert from "node:assert/strict"
import {
  EFFORT_LEVELS,
  MAX_OUTPUT_TOKEN_OPTIONS,
} from "../../constants/generation-settings.ts"
import { CHAT_MODELS, isChatModelId } from "../../constants/model.ts"
import { THREAD_CHAT_MODEL_OPTIONS } from "../../constants/client-model.ts"
import { icelandModels as icelandModelConfig } from "../../constants/models/index.ts"
import {
  getModelRouteProvider,
  resolveChatModel,
  resolveChatModelWithRoute,
} from "../../lib/ai/llm/model-routes.ts"
import { PROVIDERS } from "../../lib/ai/llm/providers.ts"
import { resolvePromptCachePolicy } from "../../lib/thread-chat/streaming/prompt-cache-policy.ts"
import {
  isIcelandRelayConfigured,
  normalizeIcelandRelayBaseURL,
} from "../../lib/ai/llm/iceland-relay.ts"

assert.equal(
  new Set(CHAT_MODELS.map((model) => model.id)).size,
  CHAT_MODELS.length
)
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
assert.equal(icelandModels.length, icelandModelConfig.models.length)
assert.equal(icelandOptions.length, icelandModelConfig.models.length)
assert.ok(icelandModels.every((model) => model.unbilledPreview === true))

const configurableIcelandModelIds = [
  "iceland-claude-fable-5",
  "iceland-claude-fable-5-1",
  "iceland-claude-opus-4-6",
  "iceland-claude-opus-4-7",
  "iceland-claude-opus-4-8",
  "iceland-claude-opus-5",
]
assert.deepEqual(
  icelandModels
    .filter((model) => model.capabilities.generationSettings)
    .map((model) => model.id)
    .sort(),
  configurableIcelandModelIds
)
for (const model of icelandModels) {
  const capability = model.capabilities.generationSettings
  if (!configurableIcelandModelIds.includes(model.id)) {
    assert.equal(capability, undefined)
    continue
  }
  assert.deepEqual(capability.effortLevels, EFFORT_LEVELS)
  assert.deepEqual(capability.maxOutputTokenOptions, MAX_OUTPUT_TOKEN_OPTIONS)
}
assert.ok(
  CHAT_MODELS.every(
    (model) =>
      !("upstreamModel" in model) &&
      !("gatewayModel" in model) &&
      !("icelandProtocol" in model)
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
  for (const name of ["claude-opus-5", "claude-sonnet-5"]) {
    const resolved = resolveChatModelWithRoute(`iceland-${name}`)
    assert.equal(resolved.model.modelId, name)
    assert.deepEqual(resolved.route, {
      actualProvider: "iceland-relay",
      protocol: "anthropic",
      upstreamModel: name,
    })
    assert.equal(
      resolvePromptCachePolicy(resolved.route).explicitCacheEnabled,
      false
    )
  }
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
assert.throws(() => resolveChatModelWithRoute("not-registered"), /未知模型/)
for (const provider of Object.values(PROVIDERS)) {
  for (const { route } of provider.routes) {
    assert.ok(route.identity.actualProvider)
    assert.ok(route.identity.protocol)
    assert.ok(route.identity.upstreamModel)
    assert.equal(
      resolvePromptCachePolicy(route.identity).explicitCacheEnabled,
      false
    )
  }
}
assert.equal(
  PROVIDERS.openai.routes[0].route.identity.actualProvider,
  "vercel-ai-gateway"
)
assert.equal(
  PROVIDERS.deepseek.routes[0].route.identity.actualProvider,
  "cloudflare-ai-gateway"
)

console.log(
  "PASS  model routes, public fields, Iceland relay, and unknown model rejection"
)
