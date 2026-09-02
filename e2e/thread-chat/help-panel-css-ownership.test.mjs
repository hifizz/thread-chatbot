import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const switcher = readFileSync(
  new URL("../../app/thread-chat/styles/switcher.css", import.meta.url),
  "utf8"
)
const helpPanel = readFileSync(
  new URL("../../app/thread-chat/styles/help-panel.css", import.meta.url),
  "utf8"
)
const entry = readFileSync(
  new URL("../../app/thread-chat/thread-chat.css", import.meta.url),
  "utf8"
)

assert.doesNotMatch(switcher, /\.helpx/)
assert.equal(helpPanel.match(/\.tc \.helpx\s*\{/g)?.length, 1)
assert.equal(helpPanel.match(/\.tc \.helpx-section\s*\{/g)?.length, 1)
assert.equal(entry.match(/@import "\.\/styles\/help-panel\.css";/g)?.length, 1)
assert.ok(
  entry.indexOf('switcher.css"') < entry.indexOf('help-panel.css"') &&
    entry.indexOf('help-panel.css"') < entry.indexOf('drawer.css"')
)

console.log(
  "PASS  help panel styles have one owner immediately after switcher styles"
)
