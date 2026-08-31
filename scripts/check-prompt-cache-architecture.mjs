import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8")
}

const generationPlan = await source(
  "lib/thread-chat/streaming/generation-plan.ts"
)
const promptBuilder = await source("lib/chat/thread-chat-prompt.ts")
const commands = await source("lib/thread-chat/contracts/commands.ts")
const quoteDomain = await source("lib/thread-chat/domain/thread-quote.ts")
const compiler = await source(
  "lib/thread-chat/application/prompt-compiler.ts"
)
const tools = await source("lib/thread-chat/streaming/generation-tools.ts")

assert.doesNotMatch(
  generationPlan,
  /buildThreadChatSystem/,
  "generation plan must consume the compiler, not rebuild dynamic system text"
)
assert.doesNotMatch(
  generationPlan,
  /system\s*=\s*\[/,
  "generation plan must not own a second system concatenation path"
)
assert.doesNotMatch(
  promptBuilder,
  /THREAD_CHAT_BRANCH_PREFIX|THREAD_CHAT_BRANCH_SUFFIX/,
  "concrete branch anchor must not return to the system prompt"
)
assert.doesNotMatch(
  commands,
  /additionalQuotes/,
  "new Fork first turn has only the server-derived origin quote"
)
assert.doesNotMatch(
  quoteDomain,
  /sourceThreadId/,
  "ordinary Quote command input must not expose cross-thread source selection"
)
assert.match(
  compiler,
  /compilePromptBase/,
  "base prompt compiler must remain the stable-history entrypoint"
)
assert.match(
  compiler,
  /finalizeGenerationPrompt/,
  "final prompt compiler must remain the only request finalizer"
)
assert.match(
  compiler,
  /runtime-control/,
  "dynamic research control must be represented after stable history"
)
assert.match(
  tools,
  /thread-answer-v1/,
  "versioned Tool Profiles must remain explicit"
)
assert.match(
  tools,
  /toolProfileHash|canonicalHash/,
  "Provider-visible Tool Schema must keep a deterministic hash"
)

console.log("PASS prompt cache architecture guard")
