import assert from "node:assert/strict"
import {
  shouldSubmitComposerKey,
} from "../../lib/chat/composer-keyboard.ts"
import { shouldInlinePastedText } from "../../app/thread-chat/chat/composer/thread-attachment-model.ts"

assert.equal(shouldInlinePastedText("x".repeat(4_000)), true)
assert.equal(shouldInlinePastedText("x".repeat(4_001)), false)

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

// 模拟微信键盘派发普通 Enter；横屏和平板不依赖视口宽度判断。
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
let touch = true
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { matchMedia: () => ({ matches: touch }) },
})
try {
  const enter = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 }
  assert.equal(shouldSubmitComposerKey(enter), false)
  assert.equal(shouldSubmitComposerKey({ ...enter, keyCode: 0 }), false)
  touch = false
  assert.equal(shouldSubmitComposerKey(enter), true)
  assert.equal(shouldSubmitComposerKey({ ...enter, shiftKey: true }), false)
  assert.equal(shouldSubmitComposerKey({ ...enter, isComposing: true }), false)
  assert.equal(shouldSubmitComposerKey({ ...enter, keyCode: 229 }), false)
} finally {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
  else delete globalThis.window
}

console.log("PASS  mobile Enter never submits; desktop Enter/Shift/IME guards and inline paste limit preserved")
