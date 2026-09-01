import assert from "node:assert/strict"
import {
  compilePromptBase,
  finalizeGenerationPrompt,
  selectGenerationRequestForCacheMode,
} from "../../lib/thread-chat/application/prompt-compiler.ts"

const context = {
  inheritedMessages: [
    { role: "user", content: [{ type: "text", text: "A1" }] },
    { role: "assistant", content: [{ type: "text", text: "A2" }] },
  ],
  branchMessages: [
    { role: "user", content: [{ type: "text", text: "B1" }] },
  ],
  omittedInheritedMessages: 0,
  forkContextIds: ["a1", "a2"],
}

function compiled(mode) {
  return finalizeGenerationPrompt({
    base: compilePromptBase({ system: "stable kernel", context }),
    tools: {},
    toolProfileId: "thread-answer-v1",
    toolProfileHash: "tool-hash",
    routeId: "fake:route",
    cacheMode: mode,
    cacheSupported: true,
    minimumPrefixTokens: 1,
    providerOptions: { gateway: { caching: "auto" } },
  })
}

for (const mode of ["off", "observe"]) {
  const candidate = compiled(mode)
  const sent = selectGenerationRequestForCacheMode({
    mode,
    compiled: candidate,
    legacySystem: "legacy dynamic system",
    legacyMessages: context.inheritedMessages.concat(context.branchMessages),
    legacyTools: {},
  })
  assert.equal(sent.variant, "legacy")
  assert.equal(sent.system, "legacy dynamic system")
  assert.equal(sent.providerOptions, undefined)
  assert.equal(candidate.manifest.sentPromptVariant, "legacy")
  assert.equal(candidate.manifest.cacheEligibility.eligible, false)
  assert.equal(
    candidate.manifest.cacheEligibility.reason,
    mode === "off" ? "off" : "observe-only"
  )
}

const enabledCandidate = compiled("enabled")
const enabled = selectGenerationRequestForCacheMode({
  mode: "enabled",
  compiled: enabledCandidate,
  legacySystem: "legacy dynamic system",
  legacyMessages: context.inheritedMessages.concat(context.branchMessages),
  legacyTools: {},
})
assert.equal(enabled.variant, "compiled")
assert.equal(enabled.system, "stable kernel")
assert.deepEqual(enabled.providerOptions, { gateway: { caching: "auto" } })
assert.equal(enabledCandidate.manifest.sentPromptVariant, "compiled")
assert.equal(enabledCandidate.manifest.cacheEligibility.eligible, true)

console.log("prompt rollout mode tests passed")
