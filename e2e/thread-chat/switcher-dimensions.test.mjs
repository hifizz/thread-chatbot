import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { SWITCHER_DIMENSIONS } from "../../app/thread-chat/orchestration/navigation/switcher-dimensions.ts"

assert.deepEqual(SWITCHER_DIMENSIONS, {
  column: { width: 330, height: 420 },
  subtree: { width: 340, height: 400 },
})

const [hook, component, localCss, subtreeCss] = await Promise.all([
  readFile(
    new URL("../../app/thread-chat/orchestration/overlays/use-workspace-overlays.ts", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../../app/thread-chat/orchestration/navigation/thread-switcher.tsx", import.meta.url),
    "utf8"
  ),
  readFile(new URL("../../app/thread-chat/styles/switcher.css", import.meta.url), "utf8"),
  readFile(
    new URL("../../app/thread-chat/styles/switcher-subtree.css", import.meta.url),
    "utf8"
  ),
])

assert.match(hook, /SWITCHER_DIMENSIONS/)
assert.match(component, /--swx-panel-width/)
assert.match(localCss, /var\(--swx-panel-width\)/)
assert.match(subtreeCss, /var\(--swx-panel-height\)/)
assert.doesNotMatch(localCss, /min\(330px/)
assert.doesNotMatch(subtreeCss, /min\(340px/)

console.log("PASS  switcher positioning and CSS share one dimension source")
