import assert from "node:assert/strict"
import { after, test, mock } from "node:test"
import { JSDOM } from "jsdom"
import { createElement, act } from "react"

// React DOM 组件交互测试；不将模拟 DOM 结果计作真实浏览器布局验收。
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://sharing.test", pretendToBeVisual: true })
const previous = new Map()
for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "DocumentFragment", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, value: typeof dom.window[key] === "function" && /^(getComputedStyle|requestAnimationFrame|cancelAnimationFrame)$/.test(key) ? dom.window[key].bind(dom.window) : dom.window[key] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
const { createRoot } = await import("react-dom/client")
const { ShareDialog } = await import("../../app/thread-chat/orchestration/sharing/share-dialog.tsx")
const { shareLayoutSchema } = await import("../../lib/thread-chat/sharing/contracts.ts")
const layout = shareLayoutSchema.parse({})
const result = (id) => ({ id, path: "/share/" + id.repeat(32), createdAt: new Date().toISOString(), expiresAt: null, revokedAt: null, status: "active" })
const json = (body, status = 200) => Response.json(body, { status })
let handler, captured, root
mock.method(globalThis, "fetch", async (url, options) => {
  if (!options?.method) return json({ ok: true, data: [] })
  captured.push({ url, ...options })
  return handler(url, options)
})
async function mount() {
  captured = []
  root = createRoot(document.getElementById("root"))
  await act(async () => root.render(createElement(ShareDialog, { target: { resourceType: "project", resourceId: "project" }, captureLayout: () => layout, onClose() {} })))
}
async function unmount() { await act(async () => root.unmount()) }
function button(text) {
  const buttons = [...document.querySelectorAll("button")].filter((node) => node.textContent.trim() === text)
  assert.equal(buttons.length, 1, `应有唯一按钮：${text}`)
  return buttons[0]
}
async function click(text) { await act(async () => button(text).click()) }
after(() => {
  mock.restoreAll(); dom.window.close()
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test("弹窗默认无限，显示四种期限与明确的隐私提示", async () => {
  await mount()
  try {
    const select = document.querySelector("select")
    assert.equal(select.value, "unlimited")
    assert.deepEqual(new Set([...select.options].map((option) => option.value)), new Set(["3", "7", "30", "unlimited"]))
    assert.match(document.body.textContent, /后续修改不会同步/)
    assert.match(document.body.textContent, /敏感内容不会自动打码/)
    assert.equal(document.querySelector('[aria-label="新分享链接"]'), null)
  } finally { await unmount() }
})
test("连续点击只提交一次，等待响应前不展示成功链接", async () => {
  let resolve
  handler = () => new Promise((done) => { resolve = done })
  await mount()
  try {
    await act(async () => { const submit = button("创建快照链接"); submit.click(); submit.click() })
    assert.equal(captured.length, 1)
    assert.equal(JSON.parse(captured[0].body).expiry, "unlimited")
    assert.equal(document.querySelector('[aria-label="新分享链接"]'), null)
    assert.equal(button("处理中…").disabled, true)
    await act(async () => resolve(json({ ok: true, data: result("a") })))
    assert.equal(document.querySelector('[aria-label="新分享链接"]').value, "https://sharing.test/share/" + "a".repeat(32))
  } finally { await unmount() }
})
test("失败不残留旧成功链接，重试沿用同一命令和布局", async () => {
  handler = () => json({ ok: true, data: result("a") })
  await mount()
  try {
    await click("创建快照链接")
    handler = () => json({ error: "分享暂时不可用，请重试" }, 503)
    await click("创建快照链接")
    assert.equal(document.querySelector('[aria-label="新分享链接"]'), null)
    assert.match(document.querySelector('[role="alert"]').textContent, /请重试/)
    assert.equal(document.querySelector("select").disabled, true)
    const failed = captured.at(-1).body
    handler = () => json({ ok: true, data: result("b") })
    await click("重试创建")
    assert.equal(captured.at(-1).body, failed)
    assert.notEqual(JSON.parse(captured[0].body).commandId, JSON.parse(failed).commandId)
    assert.equal(document.querySelector("select").disabled, false)
    assert.equal(document.querySelector('[aria-label="新分享链接"]').value, "https://sharing.test/share/" + "b".repeat(32))
  } finally { await unmount() }
})
test("撤销成功后移除新链接并更新列表状态，复制失败提示手动复制", async () => {
  handler = () => json({ ok: true, data: result("a") })
  await mount()
  try {
    await click("创建快照链接")
    await act(async () => document.querySelector('[aria-label="新分享链接"]').parentElement.querySelector("button").click())
    assert.match(document.querySelector('[role="alert"]').textContent, /手动复制/)
    await click("撤销")
    assert.equal(captured.at(-1).method, "DELETE")
    assert.equal(document.querySelector('[aria-label="新分享链接"]'), null)
    assert.match(document.querySelector('[aria-label="已有分享"]').textContent, /已撤销/)
  } finally { await unmount() }
})

test("实际文档面板仅给 completed Markdown 展示分享入口", async () => {
  const { ProjectPanel } = await import("../../app/thread-chat/orchestration/artifacts/project-panel.tsx")
  const { sharingFixture } = await import("./snapshot-sharing-fixture.mjs")
  const f = sharingFixture()
  const selected = []
  root = createRoot(document.getElementById("root"))
  try {
    for (const [kind, sourceMessageStatus] of [["markdown", "completed"], ["markdown", "generating"], ["markdown", "stopped"], ["markdown", "failed"], ["code", "completed"], ["note", "completed"]]) {
      await act(async () => root.render(createElement(ProjectPanel, {
        project: { ...f.project, title: f.project.customTitle }, files: [], artifacts: [{ ...f.artifacts[0], kind, sourceMessageStatus }], open: true, activeId: "document",
        onClose() {}, onSelect() {}, onLocate() {}, onShareArtifact: (id) => selected.push(id), onRefresh: async () => {}, onSaveContract: async () => {}, onAddProjectFile: async () => {}, onRemoveProjectFile: async () => {},
      })))
      const share = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "分享 Markdown")
      assert.equal(!!share, kind === "markdown" && sourceMessageStatus === "completed")
      if (share) await act(async () => share.click())
    }
    assert.deepEqual(selected, ["document"])
  } finally { await unmount() }
})
