import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  clampArtifactDrawerWidth,
  closeLayer,
  drawerSideForAnchor,
  escapeOverlayTarget,
  isNarrowDrawerViewport,
  layerZIndex,
  openLayer,
  popupPosition,
  topLayer,
} from "../../app/thread-chat/orchestration/overlays/workspace-overlay-logic.ts"
import { SWITCHER_DIMENSIONS } from "../../app/thread-chat/orchestration/navigation/switcher-dimensions.ts"
import { WORKSPACE_DRAWER } from "../../constants/workspace-drawers.ts"

assert.deepEqual(openLayer(["project"], "artifacts"), ["project", "artifacts"])
assert.deepEqual(openLayer(["project", "artifacts"], "project"), [
  "artifacts",
  "project",
])
assert.deepEqual(closeLayer(["project", "artifacts"], "project"), ["artifacts"])
assert.equal(topLayer(["project", "artifacts"]), "artifacts")
assert.equal(topLayer([]), null)
assert.equal(layerZIndex(1) > layerZIndex(0), true)
assert.deepEqual(openLayer(["project", "artifacts"], "artifacts"), [
  "project",
  "artifacts",
])

assert.deepEqual(
  escapeOverlayTarget({
    internalOpen: true,
    transientStack: ["selection"],
    drawerStack: ["project"],
  }),
  { kind: "internal" }
)
assert.deepEqual(
  escapeOverlayTarget({
    transientStack: ["help", "selection"],
    drawerStack: ["project", "artifacts"],
  }),
  { kind: "transient", id: "selection" }
)
assert.deepEqual(
  escapeOverlayTarget({
    transientStack: [],
    drawerStack: ["project", "artifacts"],
  }),
  { kind: "drawer", id: "artifacts" }
)
assert.equal(
  escapeOverlayTarget({
    transientStack: ["help"],
    drawerStack: ["project"],
    isComposing: true,
  }),
  null
)
assert.equal(
  escapeOverlayTarget({
    transientStack: ["help"],
    drawerStack: ["project"],
    repeat: true,
  }),
  null
)

assert.equal(WORKSPACE_DRAWER.projectWidth, 520)
assert.equal(WORKSPACE_DRAWER.artifactDefaultWidth, WORKSPACE_DRAWER.projectWidth)
assert.equal(isNarrowDrawerViewport(959), true)
assert.equal(isNarrowDrawerViewport(960), false)
assert.equal(clampArtifactDrawerWidth(100, 1200), 320)
assert.equal(clampArtifactDrawerWidth(1000, 1200), 800)
assert.equal(clampArtifactDrawerWidth(200, 280), 280)
assert.equal(
  drawerSideForAnchor({
    anchorLeft: 100,
    anchorRight: 200,
    viewportWidth: 1200,
    drawerWidth: 400,
  }),
  "right"
)
assert.equal(
  drawerSideForAnchor({
    anchorLeft: 900,
    anchorRight: 1000,
    viewportWidth: 1200,
    drawerWidth: 400,
  }),
  "left"
)
assert.equal(
  drawerSideForAnchor({
    anchorLeft: 500,
    anchorRight: 590,
    viewportWidth: 1200,
    drawerWidth: 700,
  }),
  "left",
  "默认右侧会碰撞 anchor 时应翻到左侧"
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

const overlayHook = await readFile(
  new URL(
    "../../app/thread-chat/orchestration/overlays/use-workspace-overlays.ts",
    import.meta.url
  ),
  "utf8"
)
assert.match(overlayHook, /const escapeStateRef = useRef/)
assert.match(overlayHook, /const current = escapeStateRef\.current/)
assert.match(
  overlayHook,
  /document\.removeEventListener\("keydown", onKey\)\n  \}, \[\n    toggleGlobalSwitcher,\n    toggleTreeList,\n    closeSwitcher,\n    closeTreeList,\n    closeHelpPanel,\n    closeDrawer,\n  \]\)/
)

console.log(
  "PASS  workspace overlay stack, Escape, sizing, side, and popup logic"
)
