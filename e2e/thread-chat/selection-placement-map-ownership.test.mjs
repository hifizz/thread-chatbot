import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const component = await readFile(
  new URL("../../app/thread-chat/branching/selection/selection-bubble.tsx", import.meta.url),
  "utf8"
)
const placementMap = await readFile(
  new URL(
    "../../app/thread-chat/branching/selection/selection-placement-map.tsx",
    import.meta.url
  ),
  "utf8"
)

assert.match(component, /<SelectionPlacementMap/)
assert.doesNotMatch(component, /className="slotmap"/)
assert.doesNotMatch(component, /className="smcell/)
assert.match(placementMap, /className="slotmap"/)
assert.match(placementMap, /className="smcell ghost"/)
assert.match(placementMap, /event\.key === "Enter" \|\| event\.key === " "/)

console.log("PASS  SelectionBubble composes one dedicated placement-map view")
