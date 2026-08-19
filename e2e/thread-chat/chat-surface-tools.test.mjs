import assert from "node:assert/strict"
import { surfaceTools } from "../../app/api/chat/surface-tools.ts"
import { MARKDOWN_ARTIFACT_TOOL_NAME } from "../../lib/chat/markdown-artifact.ts"

assert.deepEqual(
  Object.keys(
    surfaceTools({ threadChat: false, markdownArtifactRequested: false })
  ).sort(),
  ["compareTable", "getWeather"]
)
assert.deepEqual(
  Object.keys(
    surfaceTools({ threadChat: true, markdownArtifactRequested: false })
  ),
  []
)
assert.deepEqual(
  Object.keys(
    surfaceTools({ threadChat: true, markdownArtifactRequested: true })
  ),
  [MARKDOWN_ARTIFACT_TOOL_NAME]
)

console.log(
  "PASS  chat surface tools isolate linear helpers and gate Thread Markdown artifacts"
)
