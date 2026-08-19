import assert from "node:assert/strict"
import { webResearchPlacement } from "../../app/thread-chat/branching/web-research-placement.ts"

const empty = webResearchPlacement({ webResearchTextOffset: 12 })
assert.deepEqual(empty, { activities: [], insertAt: undefined })

const activity = { kind: "search", toolCallId: "tool-1" }
assert.deepEqual(
  webResearchPlacement({ webResearch: [activity], webResearchTextOffset: 12 }),
  { activities: [activity], insertAt: 12 }
)
assert.equal(webResearchPlacement({ webResearch: [activity] }).insertAt, 0)

console.log(
  "PASS  web research placement waits for activity and preserves recorded/fallback offsets"
)
