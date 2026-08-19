import assert from "node:assert/strict"
import {
  escapeOverlayTarget,
  popupPosition,
} from "../../app/thread-chat/orchestration/workspace-overlay-logic.ts"
import { SWITCHER_DIMENSIONS } from "../../app/thread-chat/orchestration/switcher-dimensions.ts"

assert.equal(
  escapeOverlayTarget({
    helpOpen: true,
    treeListOpen: true,
    selectionOpen: true,
    switcherOpen: true,
    drawerOpen: true,
  }),
  "help"
)
assert.equal(
  escapeOverlayTarget({
    helpOpen: false,
    treeListOpen: false,
    selectionOpen: true,
    switcherOpen: true,
    drawerOpen: true,
  }),
  "selection"
)
assert.equal(
  escapeOverlayTarget({
    helpOpen: false,
    treeListOpen: false,
    selectionOpen: false,
    switcherOpen: false,
    drawerOpen: false,
  }),
  null
)

assert.deepEqual(
  popupPosition({
    right: 900,
    bottom: 700,
    panelWidth: SWITCHER_DIMENSIONS.column.width,
    panelHeight: SWITCHER_DIMENSIONS.column.height,
    viewportWidth: 800,
    viewportHeight: 600,
  }),
  { x: 462, y: 170 }
)
assert.deepEqual(
  popupPosition({
    right: 100,
    bottom: 50,
    panelWidth: SWITCHER_DIMENSIONS.column.width,
    panelHeight: SWITCHER_DIMENSIONS.column.height,
    viewportWidth: 800,
    viewportHeight: 600,
  }),
  { x: 8, y: 56 }
)

console.log(
  "PASS  workspace overlays preserve Escape priority and clamp popup positions"
)
