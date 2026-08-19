import assert from "node:assert/strict"
import {
  composerSubmission,
  shouldSubmitComposerKey,
} from "../../app/thread-chat/chat/conversation-composer-logic.ts"

assert.equal(composerSubmission("  hello  ", false), "hello")
assert.equal(composerSubmission("   \n ", false), null)
assert.equal(composerSubmission("hello", true), null)

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
