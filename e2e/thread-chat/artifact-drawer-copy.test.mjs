import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(
  new URL(
    "../../app/thread-chat/orchestration/artifacts/artifact-drawer.tsx",
    import.meta.url
  ),
  "utf8"
)

assert.match(source, /a\?\.kind === "markdown"/)
assert.match(source, /copy\(a\.content\)/)
assert.match(source, /copied \? "已复制" : "复制"/)
assert.doesNotMatch(source, /copy\([^)]*(innerHTML|textContent)/)

console.log("PASS  artifact drawer copies the active raw Markdown content")
