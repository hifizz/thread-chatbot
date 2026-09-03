import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const actions = readFileSync(
  new URL("../../app/thread-chat/styles/message-actions.css", import.meta.url),
  "utf8"
)
const drawer = readFileSync(
  new URL("../../app/thread-chat/styles/drawer.css", import.meta.url),
  "utf8"
)
const topbar = readFileSync(
  new URL("../../app/thread-chat/styles/topbar.css", import.meta.url),
  "utf8"
)

for (const deadSelector of [
  "historical-artifact",
  "art-tabs",
  "art-tab",
  "art-src",
  "art-empty",
]) {
  assert.doesNotMatch(`${actions}\n${drawer}`, new RegExp(`\\.${deadSelector}(?![\\w-])`))
}

assert.match(drawer, /\.layered-drawer\.right/)
assert.match(drawer, /\.layered-drawer\.left/)
assert.match(drawer, /\.layered-drawer\.left[\s\S]*?left:\s*0/)
assert.match(drawer, /\.layered-drawer\.left[\s\S]*?translateX\(-103%\)/)
assert.match(drawer, /\.layered-drawer\.left \.layered-drawer-resizer/)
assert.match(
  drawer,
  /transition:\s*transform 0\.22s cubic-bezier\(0\.4, 0, 1, 1\)/
)
assert.match(
  drawer,
  /\.layered-drawer\[data-open\][\s\S]*?transition-duration:\s*0\.34s/
)
assert.match(
  drawer,
  /\.layered-drawer\[data-open\][\s\S]*?cubic-bezier\(0\.32, 0\.72, 0, 1\)/
)
assert.match(
  drawer,
  /\.layered-drawer\.right\[data-starting-style\][\s\S]*?translateX\(103%\)/
)
assert.match(
  drawer,
  /\.layered-drawer\.left\[data-starting-style\][\s\S]*?translateX\(-103%\)/
)
assert.match(drawer, /touch-action:\s*none/)
assert.match(drawer, /\.project-resource-list\.dense/)
assert.match(drawer, /@container\s*\(max-width:\s*340px\)/)
assert.match(topbar, /\.tc \.topbar[\s\S]*?z-index:\s*69/)

console.log("PASS  drawer CSS has layered sides, dense mode, topbar level, and no dead selectors")
