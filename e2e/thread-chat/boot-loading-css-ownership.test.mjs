import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const bootLoading = readFileSync(
  new URL("../../app/thread-chat/styles/boot-loading.css", import.meta.url),
  "utf8"
)
const canvas = readFileSync(
  new URL("../../app/thread-chat/styles/canvas.css", import.meta.url),
  "utf8"
)
const entry = readFileSync(
  new URL("../../app/thread-chat/thread-chat.css", import.meta.url),
  "utf8"
)

assert.equal(bootLoading.match(/\.tc \.boot-loading\s*\{/g)?.length, 1)
assert.doesNotMatch(canvas, /\.boot-loading/)
assert.match(canvas, /\.tc \.canvas-loading\s*\{/)
assert.equal(
  entry.match(/@import "\.\/styles\/boot-loading\.css";/g)?.length,
  1
)

console.log("PASS  application boot loading styles are isolated from canvas")
