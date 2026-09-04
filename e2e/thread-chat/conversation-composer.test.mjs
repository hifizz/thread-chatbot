import assert from "node:assert/strict"
import {
  composerMaxHeight,
  composerSubmission,
  shouldSubmitComposerKey,
} from "../../app/thread-chat/chat/composer/conversation-composer-logic.ts"
import { shouldInlinePastedText } from "../../app/thread-chat/chat/composer/thread-attachment-model.ts"

assert.equal(composerSubmission("  hello  ", false), "hello")
assert.equal(composerSubmission("   \n ", false), null)
assert.equal(composerSubmission("hello", true), null)
assert.equal(shouldInlinePastedText("x".repeat(4_000)), true)
assert.equal(shouldInlinePastedText("x".repeat(4_001)), false)
assert.equal(composerMaxHeight("column"), 120)
assert.equal(composerMaxHeight("canvas"), 68)

assert.equal(
  shouldSubmitComposerKey({
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
  }),
  true
)
for (const input of [
  { key: "Enter", shiftKey: true, isComposing: false, keyCode: 13 },
  { key: "Enter", shiftKey: false, isComposing: true, keyCode: 13 },
  { key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 },
  { key: "a", shiftKey: false, isComposing: false, keyCode: 65 },
]) {
  assert.equal(shouldSubmitComposerKey(input), false)
}

console.log(
  "PASS  conversation composer normalizes send text and preserves Enter/Shift/IME guards"
)
