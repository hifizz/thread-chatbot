import assert from "node:assert/strict"
import test from "node:test"
import { createScrollWriter, loadScrollPosition, saveScrollPosition } from "../../lib/thread-chat/scroll-memory.ts"
import { SCROLL_MEMORY_KEY, SCROLL_MEMORY_LIMIT, SCROLL_SAVE_INTERVAL_MS } from "../../constants/scroll-restoration.ts"

const position = (top) => ({ top, left: 0, atEnd: false })

await test("连续滚动固定频率落盘，停止后保存末值，测量也被节流", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const writes = []
  let reads = 0
  const writer = createScrollWriter((p) => writes.push(p.top))
  for (let i = 1; i <= 5; i++) {
    writer.push(() => { reads++; return position(i) })
    t.mock.timers.tick(SCROLL_SAVE_INTERVAL_MS / 5)
  }
  assert.deepEqual(writes, [5])
  assert.equal(reads, 1)
  writer.push(() => position(9))
  t.mock.timers.tick(SCROLL_SAVE_INTERVAL_MS)
  assert.deepEqual(writes, [5, 9])
  writer.flush()
  assert.deepEqual(writes, [5, 9])
})

await test("刷新或卸载立即读最后位置并取消延迟写入", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const writes = []
  let top = 10
  const writer = createScrollWriter((p) => writes.push(p.top))
  writer.push(() => position(top))
  top = 37
  writer.flush()
  assert.deepEqual(writes, [37])
  t.mock.timers.tick(SCROLL_SAVE_INTERVAL_MS * 2)
  assert.deepEqual(writes, [37])
})

await test("按项目、Thread 隔离，恢复阅读锚点并限制缓存容量", () => {
  const data = new Map()
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  }
  const first = JSON.stringify(["project-a", "thread:main"])
  const second = JSON.stringify(["project-b", "thread:main"])
  const anchored = { ...position(321), anchor: "message-5", offset: -10 }
  saveScrollPosition(first, anchored)
  saveScrollPosition(second, position(654))
  assert.deepEqual(loadScrollPosition(first), anchored)
  assert.equal(loadScrollPosition(second).top, 654)
  for (let i = 0; i < SCROLL_MEMORY_LIMIT; i++) saveScrollPosition(`thread-${i}`, position(i))
  assert.equal(loadScrollPosition(first), undefined)
  assert.equal(JSON.parse(data.get(SCROLL_MEMORY_KEY)).length, SCROLL_MEMORY_LIMIT)
  data.set(SCROLL_MEMORY_KEY, JSON.stringify([["bad", { top: -1, left: 0, atEnd: false }]]))
  assert.equal(loadScrollPosition("bad"), undefined)
  data.set(SCROLL_MEMORY_KEY, "broken-json")
  assert.equal(loadScrollPosition(first), undefined)
  delete globalThis.localStorage
})

await test("存储不可用时不阻断界面", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new Error("blocked") },
  })
  assert.equal(loadScrollPosition("any"), undefined)
  assert.doesNotThrow(() => saveScrollPosition("any", position(1)))
  delete globalThis.localStorage
})

const { restoreScrollPosition } = await import("../../lib/thread-chat/restore-scroll-position.ts")

await test("恢复控制器：延迟布局、用户接管、刷新末值及监听清理", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const data = new Map()
  const windowTarget = new EventTarget()
  const documentTarget = new EventTarget()
  const observers = []
  Object.assign(globalThis, {
    localStorage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) },
    window: Object.assign(windowTarget, { setTimeout }),
    document: Object.assign(documentTarget, { visibilityState: "visible" }),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe() {}
      disconnect() { this.disconnected = true }
    },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
  })
  class Viewport extends EventTarget {
    clientHeight = 100
    scrollHeight = 200
    scrollLeft = 0
    value = 0
    firstElementChild = {}
    get scrollTop() { return this.value }
    set scrollTop(top) { this.value = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight)) }
    getBoundingClientRect() { return { top: 0 } }
    querySelectorAll() { return [] }
  }
  try {
    const viewport = new Viewport()
    saveScrollPosition("saved", position(500))
    const modes = []
    const dispose = restoreScrollPosition(viewport, "saved", true, (atEnd) => modes.push(atEnd))
    assert.deepEqual(modes, [false], "读旧消息时释放自动贴底")
    assert.equal(viewport.scrollTop, 100, "内容尚未加载时暂时夹紧")
    viewport.scrollHeight = 1000
    observers[0].callback()
    t.mock.timers.tick(0)
    assert.equal(viewport.scrollTop, 500, "内容增长后恢复原位置")
    viewport.dispatchEvent(new Event("wheel"))
    viewport.scrollTop = 620
    viewport.dispatchEvent(new Event("scroll"))
    window.dispatchEvent(new Event("pagehide"))
    assert.equal(loadScrollPosition("saved").top, 620, "刷新立即保存")
    viewport.scrollTop = 650
    dispose()
    assert.equal(loadScrollPosition("saved").top, 650, "卸载补记尚未发出 scroll 事件的末值")
    viewport.scrollTop = 700
    viewport.dispatchEvent(new Event("scroll"))
    t.mock.timers.tick(3000)
    assert.equal(loadScrollPosition("saved").top, 650)
    assert.equal(observers[0].disconnected, true)

    saveScrollPosition("bottom", { ...position(700), atEnd: true })
    const disposeBottom = restoreScrollPosition(viewport, "bottom", true, (atEnd) => modes.push(atEnd))
    assert.equal(modes.at(-1), true)
    assert.equal(viewport.scrollTop, 900)
    disposeBottom()

    const anchor = { getAttribute: () => "message", getBoundingClientRect: () => ({ top: 450 - viewport.scrollTop, bottom: 650 - viewport.scrollTop }) }
    viewport.querySelectorAll = () => [anchor]
    saveScrollPosition("anchor", { ...position(300), anchor: "message", offset: -20 })
    const disposeAnchor = restoreScrollPosition(viewport, "anchor", true)
    assert.equal(viewport.scrollTop, 470, "换行后按消息内偏移恢复")
    viewport.scrollTop = 550
    viewport.dispatchEvent(new Event("scroll"))
    observers.at(-1).callback()
    t.mock.timers.tick(0)
    assert.equal(viewport.scrollTop, 550, "显式跳转优先于恢复")
    disposeAnchor()
  } finally {
    for (const key of ["localStorage", "window", "document", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"]) delete globalThis[key]
  }
})
