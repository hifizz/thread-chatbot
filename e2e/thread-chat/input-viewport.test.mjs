import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import { scrollMenuOptionIntoView } from "../../lib/thread-chat/scroll-menu-option.ts"
import { VIEWPORT_SETTLE_MS, VIEWPORT_SCALE_TOLERANCE } from "../../constants/thread-viewport.ts"

// 执行真实 Hook 的副作用，模拟浏览器事件；不把模拟结果当作 iOS 真机验收。
const source = readFileSync(new URL("../../app/thread-chat/orchestration/use-input-viewport.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const viewport = new EventTarget()
Object.assign(viewport, { height: 720, offsetTop: 0, scale: 1 })
const document = new EventTarget()
document.visibilityState = "visible"
const window = new EventTarget()
const touch = new EventTarget()
touch.matches = true
const timers = new Map()
const frames = new Map()
let nextId = 0
Object.assign(window, {
  visualViewport: viewport,
  matchMedia: () => touch,
  setTimeout: (fn, delay) => { assert.equal(delay, VIEWPORT_SETTLE_MS); timers.set(++nextId, fn); return nextId },
  clearTimeout: (id) => timers.delete(id),
})
const properties = new Map()
const root = {
  dataset: {},
  style: { setProperty: (key, value) => properties.set(key, value), removeProperty: (key) => properties.delete(key) },
}
let effect
const exports = {}
vm.runInNewContext(compiled, {
  exports, window, document,
  requestAnimationFrame: (fn) => { frames.set(++nextId, fn); return nextId },
  cancelAnimationFrame: (id) => frames.delete(id),
  require: (name) => {
    if (name === "react") return { useEffect: (fn) => { effect = fn } }
    if (name === "@/constants/thread-viewport") return { VIEWPORT_SETTLE_MS, VIEWPORT_SCALE_TOLERANCE }
    throw new Error(name)
  },
})
const flushFrames = () => { const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn()) }
const flushTimers = () => { const work = [...timers.values()]; timers.clear(); work.forEach((fn) => fn()) }
const fire = (target, type) => target.dispatchEvent(new Event(type))
exports.useInputViewport({ current: root }, true)
const cleanup = effect()
flushFrames()
assert.equal(properties.get("--tc-input-height"), "720px", "未聚焦也匹配可见高度")
viewport.height = 360; viewport.offsetTop = 24
fire(viewport, "resize"); fire(viewport, "scroll")
assert.equal(frames.size, 1, "同一帧合并键盘尺寸与偏移事件")
flushFrames()
assert.equal(properties.get("--tc-input-height"), "360px")
assert.equal(properties.get("--tc-input-top"), "24px")

viewport.scale = 1.5
fire(viewport, "resize"); flushFrames()
assert.equal(properties.size, 0, "用户主动缩放时释放布局")
viewport.scale = 1
fire(viewport, "resize"); flushFrames()
assert.equal(root.dataset.inputViewport, "true")

// 切后台不保证触发 pagehide；还可能留下一个永远不执行的 rAF。
fire(viewport, "resize")
document.visibilityState = "hidden"
fire(document, "visibilitychange")
assert.equal(frames.size, 0, "隐藏时取消旧帧，唤醒后可以重新排帧")
assert.equal(timers.size, 0)
assert.equal(properties.size, 0, "后台清理键盘高度和偏移")
fire(viewport, "resize"); fire(document, "focusin"); fire(window, "pageshow")
assert.equal(frames.size, 0, "后台事件不重新激活补偿")
assert.equal(timers.size, 0)

// 唤醒时先读到旧的键盘高度，随后没有 resize 也应恢复。
document.visibilityState = "visible"
fire(document, "visibilitychange"); flushFrames()
assert.equal(properties.get("--tc-input-height"), "360px")
viewport.height = 680; viewport.offsetTop = 0
flushTimers(); flushFrames()
assert.equal(properties.get("--tc-input-height"), "680px", "延迟测量修正旧高度")
assert.equal(properties.get("--tc-input-top"), "0px")
viewport.height = 740
fire(viewport, "resize"); flushFrames()
assert.equal(properties.get("--tc-input-height"), "740px", "未聚焦时也跟随工具栏变化")

fire(window, "pagehide")
assert.equal(properties.size, 0)
fire(viewport, "scroll")
assert.equal(frames.size, 0)
fire(window, "pageshow"); flushFrames()
assert.equal(root.dataset.inputViewport, "true", "BFCache 返回无需输入框聚焦")
fire(document, "focusout")
viewport.height = 700
flushTimers(); flushFrames()
assert.equal(properties.get("--tc-input-height"), "700px", "失焦键盘动画后更新尺寸")

touch.matches = false
fire(touch, "change"); flushFrames()
assert.equal(properties.size, 0, "桌面使用原有 CSS 布局")
touch.matches = true
fire(touch, "change"); flushFrames()
assert.equal(properties.get("--tc-input-height"), "700px")
viewport.height = 0
fire(viewport, "resize"); flushFrames()
assert.equal(properties.size, 0, "恢复中的无效尺寸不写入布局")
viewport.height = 700
fire(viewport, "resize"); flushFrames()

fire(document, "focusin")
cleanup()
fire(document, "focusin"); fire(document, "visibilitychange")
fire(viewport, "resize"); fire(window, "pageshow"); fire(touch, "change")
assert.equal(frames.size, 0)
assert.equal(timers.size, 0)
assert.equal(properties.size, 0)

exports.useInputViewport({ current: root }, false)
assert.equal(effect(), undefined, "非分栏模式不接管布局")
window.visualViewport = null
exports.useInputViewport({ current: root }, true)
assert.equal(effect(), undefined, "无 VisualViewport 使用 CSS 回退")

const menu = { scrollTop: 50, clientTop: 1, clientHeight: 100, getBoundingClientRect: () => ({ top: 100 }) }
const option = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom }) })
scrollMenuOptionIntoView(menu, option(120, 150))
assert.equal(menu.scrollTop, 50, "可见项不滚动")
scrollMenuOptionIntoView(menu, option(80, 110))
assert.equal(menu.scrollTop, 29)
scrollMenuOptionIntoView(menu, option(190, 230))
assert.equal(menu.scrollTop, 58)
console.log("PASS: 移动端未聚焦尺寸同步、缩放、后台唤醒、BFCache、延迟恢复、清理与菜单局部滚动")
