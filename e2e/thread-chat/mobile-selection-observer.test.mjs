import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import ts from "typescript"

// 执行真实 hook 的事件逻辑；DOM 和时钟替身不等同于 iOS 原生选区验收。
const source = await readFile(new URL("../../app/thread-chat/branching/selection/use-assistant-text-selection.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText

function fixture({ mobile = true, hasDraft = false, preserveEmptySelection = false, role = "assistant", status = "done", contained = true } = {}) {
  const listeners = new Map()
  const effects = []
  const timers = new Map()
  const changes = []
  let timerId = 0
  let selection
  const root = {
    closest: (selector) => selector === ".msg-list" ? { dataset: { list: "thread" } } : { dataset: { msgId: "message" } },
    contains: () => contained,
  }
  const node = { nodeType: 3, parentElement: { closest: () => root } }
  const range = { startContainer: node, endContainer: node, getBoundingClientRect: () => ({ left: 0, top: 20, width: 100, height: 20 }) }
  const select = (text) => { selection = { anchorNode: node, rangeCount: text ? 1 : 0, toString: () => text, getRangeAt: () => range } }
  select("原始引用")
  const document = {
    activeElement: null,
    querySelector: () => null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  }
  const context = {
    exports: {}, document, Node: { TEXT_NODE: 3 }, Element: class {},
    window: { getSelection: () => selection, addEventListener() {}, removeEventListener() {} },
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId },
    clearTimeout: (id) => timers.delete(id),
    require: (name) => {
      if (name === "react") return { useEffect: (fn) => effects.push(fn), useEffectEvent: (fn) => fn }
      if (name.endsWith("selection-toolbar")) return { MOBILE_SELECTION_SETTLE_MS: 180, SELECTION_SURFACE_SELECTOR: "surface", SELECTION_TOOLBAR_SELECTOR: "toolbar" }
      if (name === "./text-anchor") return { describeRange: () => ({ quote: { exact: selection.toString() } }) }
      throw new Error(`未声明的测试依赖：${name}`)
    },
  }
  vm.runInNewContext(compiled, context)
  context.exports.useAssistantTextSelection({
    state: { threads: { thread: { messages: [{ id: "message", role, status }] } } },
    selection: null, mobile, hasDraft, preserveEmptySelection, onSelectionChange: (value) => changes.push(value),
  })
  const cleanups = effects.map((effect) => effect())
  return {
    changes, select, listeners,
    emit: (name) => listeners.get(name)?.({ target: { closest: () => null }, metaKey: false, ctrlKey: false }),
    flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()) },
    cleanup: () => cleanups.forEach((cleanup) => cleanup?.()),
  }
}

const mobile = fixture()
mobile.emit("selectionchange")
assert.equal(mobile.changes.length, 0, "等待选区稳定")
mobile.select("调整后的引用")
mobile.emit("selectionchange")
mobile.flush()
assert.equal(mobile.changes.length, 1)
assert.equal(mobile.changes[0].text, "调整后的引用")
assert.equal(mobile.changes[0].msgId, "message")
mobile.emit("mouseup")
mobile.flush()
assert.equal(mobile.changes.length, 1, "忽略手机合成鼠标事件，避免重复重置")
mobile.select("")
mobile.emit("selectionchange")
mobile.flush()
assert.equal(mobile.changes.at(-1), null)

for (const options of [{ role: "user" }, { status: "streaming" }, { contained: false }]) {
  const invalid = fixture(options)
  invalid.emit("selectionchange")
  invalid.flush()
  assert.equal(invalid.changes.at(-1), null, "拒绝无效消息或跨消息选区")
  invalid.cleanup()
}
const guarded = fixture({ hasDraft: true })
guarded.select("")
guarded.emit("selectionchange")
guarded.flush()
assert.equal(guarded.changes.length, 0, "抽屉打开或已有问题时，不因失去 DOM 选区而丢失引用")

const desktop = fixture({ mobile: false })
desktop.emit("selectionchange")
desktop.flush()
assert.equal(desktop.changes.length, 0)
desktop.emit("mouseup")
desktop.flush()
assert.equal(desktop.changes[0].text, "原始引用")

const saved = fixture({ preserveEmptySelection: true })
saved.select("")
saved.emit("selectionchange")
saved.flush()
assert.equal(saved.changes.length, 0, "收起空抽屉也保留引用快照")
saved.select("新的引用")
saved.emit("selectionchange")
saved.flush()
assert.equal(saved.changes[0].text, "新的引用", "没有问题草稿时仍可重新划选")
saved.cleanup()

mobile.select("待取消")
mobile.emit("selectionchange")
const count = mobile.changes.length
mobile.cleanup()
mobile.flush()
assert.equal(mobile.changes.length, count, "卸载取消延迟读取")
assert.equal(mobile.listeners.size, 0)
guarded.cleanup()
desktop.cleanup()
console.log("PASS 手机选区稳定采集、快照、空选清理、无效选区、草稿保护、鼠标回归和监听清理")
