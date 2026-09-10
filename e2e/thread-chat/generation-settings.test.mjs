import assert from "node:assert/strict"
import {
  DEFAULT_GENERATION_SETTINGS,
  ANTHROPIC_ADAPTIVE_GENERATION_SETTINGS,
  MAX_OUTPUT_TOKEN_OPTIONS,
} from "../../constants/generation-settings.ts"
import {
  getModelGenerationSettingsCapability,
  MAX_OUTPUT_TOKENS,
} from "../../constants/model.ts"
import { assertGenerationSettingsCapability } from "../../lib/model-catalog/validation.ts"
const assertAllowedGenerationSettings = (id, settings) => assertGenerationSettingsCapability(getModelGenerationSettingsCapability(id), settings)
import { chatAnswerGenerationOptions } from "../../lib/thread-chat/streaming/generation-settings.ts"

const supportedModelId = "iceland-claude-fable-5-1"
const unsupportedModelId = "iceland-claude-sonnet-5"
const capability = getModelGenerationSettingsCapability(supportedModelId)

assert(capability)
assert.deepEqual(capability.effortLevels, ANTHROPIC_ADAPTIVE_GENERATION_SETTINGS.effortLevels)
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

assert.deepEqual(chatAnswerGenerationOptions("answer", undefined, "anthropic"), {
  reasoning: "provider-default",
  maxOutputTokens: MAX_OUTPUT_TOKENS,
})
assert.deepEqual(chatAnswerGenerationOptions("research", undefined, "openai-compatible"), {
  reasoning: "high",
  maxOutputTokens: MAX_OUTPUT_TOKENS,
})

const customSettings = {
  effort: "max",
  maxOutputTokens: 128_000,
}
const customOptions = chatAnswerGenerationOptions(
  "answer",
  customSettings,
  "anthropic"
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

const { resolveGenerationSettings } = await import("../../lib/thread-chat/generation-settings.ts")
for (const [suffix, levels] of [
  ["gpt-5.6-luna", ["none", "low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.6-sol", ["none", "low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.6-terra", ["none", "low", "medium", "high", "xhigh", "max"]],
  ["gpt-6-astra", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.5", ["none", "low", "medium", "high", "xhigh"]],
  ["gpt-5.4", ["none", "low", "medium", "high", "xhigh"]],
  ["gpt-5.4-mini", ["none", "low", "medium", "high", "xhigh"]],
]) {
  const id = `private-relay-${suffix}`
  assert.deepEqual(getModelGenerationSettingsCapability(id).effortLevels, levels)
  for (const effort of levels) assert.doesNotThrow(() => assertAllowedGenerationSettings(id, { effort, maxOutputTokens: 128_000 }))
}
assert.equal(getModelGenerationSettingsCapability("private-relay-gpt-5.3-codex-spark"), undefined)
for (const [id, effort] of [["private-relay-gpt-6-astra", "none"], ["private-relay-gpt-5.4", "max"], [supportedModelId, "none"]]) {
  assert.throws(() => assertAllowedGenerationSettings(id, { effort, maxOutputTokens: 16_000 }))
  assert.deepEqual(resolveGenerationSettings(id, { effort, maxOutputTokens: 16_000 }), { effort: "high", maxOutputTokens: 16_000 })
}
assert.equal(resolveGenerationSettings(unsupportedModelId, DEFAULT_GENERATION_SETTINGS), undefined)
assert.deepEqual(chatAnswerGenerationOptions("research", { effort: "none", maxOutputTokens: 16_000 }, "openai-compatible"), {
  maxOutputTokens: 16_000,
  providerOptions: { openaiCompatible: { reasoningEffort: "none" } },
})
console.log("PASS GPT 能力矩阵、模型切换回退与协议参数隔离")

for (const suffix of ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "glm-5.3", "glm-5.3-flash"]) {
  const id = `token-router-${suffix}`
  const levels = suffix.startsWith("deepseek-") ? ["none", "low", "high", "max"] : ["low", "high", "max"]
  assert.deepEqual(getModelGenerationSettingsCapability(id).effortLevels, levels)
  for (const effort of levels) assert.doesNotThrow(() => assertAllowedGenerationSettings(id, { effort, maxOutputTokens: 128_000 }))
  assert.throws(() => assertAllowedGenerationSettings(id, { effort: "medium", maxOutputTokens: 16_000 }))
  if (suffix.startsWith("glm-")) {
    assert.throws(() => assertAllowedGenerationSettings(id, { effort: "none", maxOutputTokens: 16_000 }))
    assert.equal(resolveGenerationSettings(id, { effort: "none", maxOutputTokens: 16_000 }).effort, "high")
  }
}
assert.equal(getModelGenerationSettingsCapability("token-router-deepseek-v4.1-flash-expires-on-0910"), undefined)
console.log("PASS DeepSeek / GLM 思考能力、输出选项及切换回退")
