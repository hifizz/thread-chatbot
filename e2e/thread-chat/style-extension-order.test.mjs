import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const entry = readFileSync(
  new URL("../../app/thread-chat/thread-chat.css", import.meta.url),
  "utf8"
)

const imports = [...entry.matchAll(/@import "\.\/styles\/([^\"]+)";/g)].map(
  (match) => match[1]
)

assert.equal(
  imports.indexOf("columns-collapse.css"),
  imports.indexOf("columns.css") + 1
)
assert.equal(
  imports.indexOf("switcher-subtree.css"),
  imports.indexOf("switcher.css") + 1
)
assert.equal(new Set(imports).size, imports.length)

console.log(
  "PASS  component style extensions are adjacent to their base modules"
)
