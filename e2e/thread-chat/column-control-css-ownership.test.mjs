import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const columns = readFileSync(
  new URL("../../app/thread-chat/styles/columns.css", import.meta.url),
  "utf8"
)
const collapsedColumns = readFileSync(
  new URL("../../app/thread-chat/styles/columns-collapse.css", import.meta.url),
  "utf8"
)

assert.equal(columns.match(/\.tc \.cbtn\.tree\s*\{/g)?.length, 1)
assert.equal(columns.match(/\.tc \.cbtn\.tree \.n\s*\{/g)?.length, 1)
assert.doesNotMatch(collapsedColumns, /\.cbtn\.tree/)
assert.match(collapsedColumns, /\.tc \.col-strip\s*\{/)

console.log("PASS  column header controls are isolated from collapsed columns")
