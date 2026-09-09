import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import ts from "typescript"
import { scrollMenuOptionIntoView } from "../../lib/thread-chat/scroll-menu-option.ts"
import { KEYBOARD_BLUR_SETTLE_MS, VIEWPORT_SCALE_TOLERANCE } from "../../constants/thread-viewport.ts"

// 执行真实 Hook 的副作用，模拟浏览器事件；不把模拟结果当作 iOS 真机验收。
const source = readFileSync(new URL("../../app/thread-chat/orchestration/use-input-viewport.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const viewport = new EventTarget()
Object.assign(viewport, { height: 720, offsetTop: 0, scale: 1 })
const document = new EventTarget()
document.activeElement = null
const window = new EventTarget()
const timers = new Map()
const frames = new Map()
let nextId = 0
Object.assign(window, {
  visualViewport: viewport,
  matchMedia: () => ({ matches: true }),
  setTimeout: (fn, delay) => { assert.equal(delay, KEYBOARD_BLUR_SETTLE_MS); timers.set(++nextId, fn); return nextId },
  clearTimeout: (id) => timers.delete(id),
})
const properties = new Map()
const root = {
  dataset: {},
  contains: (element) => element.inside,
  style: { setProperty: (key, value) => properties.set(key, value), removeProperty: (key) => properties.delete(key) },
}
class Element {
  constructor(inside, editable) { this.inside = inside; this.editable = editable }
  matches() { return this.editable }
}
let effect
const exports = {}
vm.runInNewContext(compiled, {
  exports, window, document, HTMLElement: Element,
  requestAnimationFrame: (fn) => { frames.set(++nextId, fn); return nextId },
  cancelAnimationFrame: (id) => frames.delete(id),
  require: (name) => {
    if (name === "react") return { useEffect: (fn) => { effect = fn } }
    if (name === "@/constants/thread-viewport") return { KEYBOARD_BLUR_SETTLE_MS, VIEWPORT_SCALE_TOLERANCE }
    throw new Error(name)
  },
})
const flushFrames = () => { const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn()) }
const flushTimers = () => { const work = [...timers.values()]; timers.clear(); work.forEach((fn) => fn()) }
const fire = (target, type) => target.dispatchEvent(new Event(type))
exports.useInputViewport({ current: root }, true)
const cleanup = effect()
assert.equal(properties.size, 0)

document.activeElement = new Element(false, true)
fire(document, "focusin"); flushFrames()
assert.equal(properties.size, 0, "外部编辑器不接管工作区")
document.activeElement = new Element(true, true)
fire(document, "focusin"); flushFrames()
assert.equal(properties.get("--tc-input-height"), "720px")
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

document.activeElement = null
fire(document, "focusout")
assert.equal(root.dataset.inputViewport, "true", "失焦等待键盘动画")
document.activeElement = new Element(true, true)
fire(document, "focusin"); flushTimers(); flushFrames()
assert.equal(root.dataset.inputViewport, "true", "快速切换列内输入不复位")
document.activeElement = null
fire(document, "focusout"); flushTimers()
assert.equal(properties.size, 0)
fire(viewport, "resize")
assert.equal(frames.size, 0, "失焦后移除视口监听")

document.activeElement = new Element(true, true)
fire(document, "focusin"); flushFrames()
fire(window, "pagehide")
assert.equal(properties.size, 0)
fire(window, "pageshow"); flushFrames()
assert.equal(root.dataset.inputViewport, "true", "返回页面恢复活动输入")
cleanup()
fire(document, "focusin"); fire(viewport, "resize")
assert.equal(frames.size, 0)
assert.equal(properties.size, 0)

const menu = { scrollTop: 50, clientTop: 1, clientHeight: 100, getBoundingClientRect: () => ({ top: 100 }) }
const option = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom }) })
scrollMenuOptionIntoView(menu, option(120, 150))
assert.equal(menu.scrollTop, 50, "可见项不滚动")
scrollMenuOptionIntoView(menu, option(80, 110))
assert.equal(menu.scrollTop, 29)
scrollMenuOptionIntoView(menu, option(190, 230))
assert.equal(menu.scrollTop, 58)
console.log("PASS: 输入视口启停、缩放、动画帧合并、失焦恢复、页面恢复、清理与菜单局部滚动")
