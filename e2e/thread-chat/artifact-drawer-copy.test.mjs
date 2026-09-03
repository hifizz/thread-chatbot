import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile(
  new URL(
    "../../app/thread-chat/orchestration/artifacts/artifacts-drawer.tsx",
    import.meta.url
  ),
  "utf8"
)

assert.match(source, /selectedArtifact\.kind === "markdown"/)
assert.match(source, /copy\(selectedArtifact\.content\)/)
assert.match(source, /copied \? "Markdown 已复制" : "复制 Markdown"/)
assert.doesNotMatch(source, /copy\([^)]*(innerHTML|textContent)/)

console.log("PASS  Artifacts Drawer copies the selected raw Markdown content")
