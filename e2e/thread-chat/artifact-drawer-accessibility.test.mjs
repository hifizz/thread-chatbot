import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const base = new URL(
  "../../app/thread-chat/orchestration/artifacts/",
  import.meta.url
)
const [layered, project, artifacts] = await Promise.all([
  readFile(new URL("layered-drawer.tsx", base), "utf8"),
  readFile(new URL("project-drawer.tsx", base), "utf8"),
  readFile(new URL("artifacts-drawer.tsx", base), "utf8"),
])

// LayeredDrawer 统一处理非模态层、下层 inert 与三级焦点归还。
assert.match(layered, /modal=\{false\}/)
assert.match(layered, /aria-hidden=\{!open \|\| !topLayer\}/)
assert.match(layered, /inert=\{!open \|\| !topLayer\}/)
assert.match(layered, /data-layered-drawer-top=/)
assert.match(layered, /element\.closest\("\[inert\]"\)/)
assert.match(layered, /triggerRef\.current/)
assert.match(layered, /data-layered-drawer-close/)
assert.match(layered, /\.tc \.topbar/)
assert.match(layered, /finalFocus=\{false\}/)
assert.match(layered, /if \(!nextOpen\) queueMicrotask\(restoreFocus\)/)
assert.match(layered, /target\?\.focus\(\)/)

// 可调宽把手提供 separator、键盘、指针捕获、取消与复位语义。
assert.match(layered, /role="separator"/)
assert.match(layered, /aria-orientation="vertical"/)
assert.match(layered, /aria-valuemin=/)
assert.match(layered, /aria-valuemax=/)
assert.match(layered, /aria-valuenow=/)
assert.match(layered, /ArrowLeft/)
assert.match(layered, /ArrowRight/)
assert.match(layered, /event\.currentTarget\.setPointerCapture/)
assert.match(layered, /releasePointerCapture/)
assert.match(layered, /onPointerCancel=/)
assert.match(layered, /onDoubleClick=\{resetWidth\}/)
assert.match(layered, /delete nextPanelSizes\.artifactDrawer/)
assert.match(layered, /side === "left"/)

// 内容组件保留 dialog 命名、关闭按钮和内态优先消费 Esc。
for (const source of [project, artifacts]) {
  assert.match(source, /role="dialog"/)
  assert.match(source, /aria-labelledby=\{titleId\}/)
  assert.match(source, /data-layered-drawer-close/)
  assert.match(source, /onKeyDownCapture=/)
  assert.match(source, /event\.key\s*[!=]==?\s*"Escape"/)
  assert.match(source, /event\.stopPropagation\(\)/)
}

console.log("PASS  layered drawers expose inert, focus, Escape, and resize accessibility")
