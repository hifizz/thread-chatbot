import assert from "node:assert/strict"
import {
  DEFAULT_GENERATION_SETTINGS,
  EFFORT_LEVELS,
  MAX_OUTPUT_TOKEN_OPTIONS,
} from "../../constants/generation-settings.ts"
import {
  getModelGenerationSettingsCapability,
  MAX_OUTPUT_TOKENS,
} from "../../constants/model.ts"
import { assertAllowedGenerationSettings } from "../../lib/thread-chat/application/command-utils.ts"
import { chatAnswerGenerationOptions } from "../../lib/thread-chat/streaming/generation-settings.ts"

const supportedModelId = "iceland-claude-fable-5-1"
const unsupportedModelId = "iceland-claude-sonnet-5"
const capability = getModelGenerationSettingsCapability(supportedModelId)

assert(capability)
assert.deepEqual(capability.effortLevels, EFFORT_LEVELS)
assert.deepEqual(
  capability.maxOutputTokenOptions,
  MAX_OUTPUT_TOKEN_OPTIONS
)
assert.equal(
  getModelGenerationSettingsCapability(unsupportedModelId),
  undefined
)
assert.doesNotThrow(() =>
  assertAllowedGenerationSettings(
    supportedModelId,
    DEFAULT_GENERATION_SETTINGS
  )
)
assert.throws(() =>
  assertAllowedGenerationSettings(
    unsupportedModelId,
    DEFAULT_GENERATION_SETTINGS
  )
)

assert.deepEqual(chatAnswerGenerationOptions("answer", undefined), {
  reasoning: "provider-default",
  maxOutputTokens: MAX_OUTPUT_TOKENS,
})
assert.deepEqual(chatAnswerGenerationOptions("research", undefined), {
  reasoning: "high",
  maxOutputTokens: MAX_OUTPUT_TOKENS,
})

const customSettings = {
  effort: "max",
  maxOutputTokens: 128_000,
}
const customOptions = chatAnswerGenerationOptions(
  "answer",
  customSettings
)
assert.equal("reasoning" in customOptions, false)
assert.deepEqual(customOptions, {
  maxOutputTokens: 128_000,
  providerOptions: {
    anthropic: {
      effort: "max",
      thinking: {
        type: "adaptive",
        display: "summarized",
      },
    },
  },
})

console.log("PASS generation settings capabilities and final call options")
