import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, request } from "playwright-core"
import { db } from "../../lib/db/index.ts"
import { adminMembers } from "../../lib/db/schema.ts"
const base = process.env.BETTER_AUTH_URL
assert(base && ["localhost", "127.0.0.1"].includes(new URL(base).hostname), "只在本地隔离环境运行")
assert.equal(process.env.ADMIN_CATALOG_TEST_WRITES, "1")
assert(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname), "数据库必须是本地隔离库")
assert.equal(process.env.TOKEN_ROUTER_BASE_URL, "http://127.0.0.1:55433", "必须使用本地模拟中转服务")
const executablePath = process.env.ADMIN_TEST_CHROMIUM
assert(executablePath, "需要 ADMIN_TEST_CHROMIUM")
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--no-zygote", "--single-process", "--disable-dev-shm-usage", "--disable-gpu"] })
const shots = process.env.ADMIN_TEST_SCREENSHOTS ?? "docs/admin/screenshots"
const clockFile = process.env.ADMIN_TEST_CLOCK_FILE
let offset = 0
async function expireCache() {
  if (clockFile) {
    offset += 301_000
    await writeFile(clockFile, String(offset))
  } else {
    console.log("等待真实五分钟缓存过期")
    await new Promise((resolve) => setTimeout(resolve, 301_000))
  }
}
await mkdir(shots, { recursive: true })
const calls = []
const upstream = createServer(async (req, res) => {
  const parts = []; for await (const part of req) parts.push(part)
  const body = JSON.parse(Buffer.concat(parts).toString())
  calls.push(body)
  if (!body.stream) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ id: "test", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "测试对话" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })); return }
  res.setHeader("Content-Type", "text/event-stream")
  for (const chunk of [
    { choices: [{ index: 0, delta: { role: "assistant", content: "模型配置已生效。这是本地模拟上游的验收回复。" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 } },
  ]) res.write(`data: ${JSON.stringify({ id: "test-stream", object: "chat.completion.chunk", created: 1, model: body.model, ...chunk })}\n\n`)
  res.end("data: [DONE]\n\n")
})
await new Promise((resolve) => upstream.listen(55433, "127.0.0.1", resolve))
const pageErrors = []
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.on("pageerror", (error) => pageErrors.push(error.message))
const suffix = Date.now()
const email = `admin-${suffix}@example.test`
const password = `Local-${crypto.randomUUID()}`
const id = `admin-browser-${suffix}`
let initial
try {
  const guest = await request.newContext()
  assert.equal((await guest.get(`${base}/api/admin/models`)).status(), 401)
  assert.equal((await guest.get(`${base}/api/models`)).status(), 404)
  await guest.dispose()
  const signUp = await context.request.post(`${base}/api/auth/sign-up/email`, { headers: { origin: base }, data: { email, password, name: "Admin 验收" } })
  assert.equal(signUp.status(), 200, await signUp.text())
  const account = (await signUp.json()).user
  assert.equal((await context.request.get(`${base}/api/admin/models`)).status(), 403)
  assert.equal((await context.request.post(`${base}/api/admin/models`, { headers: { origin: base }, data: {} })).status(), 403)
  await db.insert(adminMembers).values({ userId: account.id })
  await context.request.post(`${base}/api/auth/sign-out`, { headers: { origin: base }, data: {} })
  await page.goto(`${base}/sign-in?redirect=/admin/models`)
  await page.getByLabel("邮箱", { exact: true }).fill(email)
  await page.getByLabel("密码", { exact: true }).fill(password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await page.waitForURL((url) => !url.pathname.includes("sign-in"), { timeout: 90000 })
  await page.goto(`${base}/admin/models`)
  await page.getByRole("heading", { name: "模型管理" }).waitFor()
  await page.waitForLoadState("networkidle")
  initial = await (await context.request.get(`${base}/api/admin/models`)).json()
  await page.screenshot({ animations: "disabled", path: `${shots}/models-desktop.png`, fullPage: true })
  const chatPage = await context.newPage()
  let modelRequests = 0
  chatPage.on("request", (req) => { if (new URL(req.url()).pathname === "/api/models") modelRequests++ })
  await chatPage.goto(`${base}/thread-chat/${crypto.randomUUID()}`)
  await chatPage.locator('[contenteditable="true"]').first().waitFor({ timeout: 90000 })
  assert(!(await chatPage.content()).includes('brand-new-upstream-model'), "初始化不得泄漏上游 ID")
  await page.getByRole("button", { name: "新增模型", exact: true }).click()
  await page.getByLabel("展示名称", { exact: true }).fill("验收新模型")
  await page.getByLabel("内部 ID", { exact: true }).fill(id)
  await page.getByLabel("中转服务模型 ID", { exact: true }).fill("brand-new-upstream-model")
  await page.getByRole("checkbox", { name: "图片输入", exact: true }).check()
  await page.getByRole("checkbox", { name: "推理", exact: true }).check()
  await page.getByRole("checkbox", { name: "low", exact: true }).check()
  await page.getByRole("checkbox", { name: "high", exact: true }).check()
  await page.getByLabel("默认 effort", { exact: true }).selectOption("low")
  await page.getByLabel("模型输出上限", { exact: true }).fill("8192")
  await page.getByLabel("默认输出长度", { exact: true }).fill("4096")
  await page.getByLabel("用户可选输出档位", { exact: true }).fill("4096, 8192")
  await page.getByRole("checkbox", { name: "启用此模型", exact: true }).check()
  await page.screenshot({ animations: "disabled", path: `${shots}/model-editor.png` })
  await page.getByRole("button", { name: "保存模型", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  let catalog = await (await context.request.get(`${base}/api/admin/models`)).json()
  const saved = catalog.models.find((m) => m.id === id)
  assert(saved?.enabled)
  assert.equal(saved.config.defaultMaxOutputTokens, 4096)
  const write = { id: saved.id, enabled: saved.enabled, sortOrder: saved.sortOrder, version: saved.version, config: saved.config }
  assert.equal((await context.request.post(`${base}/api/admin/models`, { headers: { origin: "https://wrong-origin.test" }, data: write })).status(), 403)
  assert.equal((await context.request.post(`${base}/api/admin/models`, { headers: { origin: base }, data: { ...write, version: 0 } })).status(), 409)
  assert.equal((await context.request.post(`${base}/api/admin/models`, { headers: { origin: base }, data: { ...write, config: { ...write.config, defaultEffort: "max" } } })).status(), 400)
  await page.getByLabel("搜索模型", { exact: true }).fill(id)
  await page.getByRole("button", { name: "验收新模型", exact: true }).click()
  await page.getByLabel("默认 effort", { exact: true }).selectOption("high")
  await page.getByRole("button", { name: "保存模型", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "验收新模型 操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "复制配置", exact: true }).click()
  assert.equal(await page.getByLabel("内部 ID", { exact: true }).inputValue(), "")
  assert.equal(await page.getByLabel("默认 effort", { exact: true }).inputValue(), "high")
  assert.equal(await page.getByRole("checkbox", { name: "启用此模型", exact: true }).isChecked(), false)
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "验收新模型 操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "设为默认模型", exact: true }).click()
  await page.getByText("默认", { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "切换侧边栏", exact: true }).click()
  await page.getByRole("link", { name: "模型管理", exact: true }).last().waitFor()
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('[data-mobile="true"]')
    return sidebar && getComputedStyle(sidebar).opacity === "1"
  })
  await page.waitForLoadState("networkidle")
  await page.screenshot({ animations: "disabled", path: `${shots}/models-mobile-navigation.png` })
  await page.keyboard.press("Escape")
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "移动端页面不得撑出横向滚动")
  await page.setViewportSize({ width: 1440, height: 1000 })
  await chatPage.evaluate(() => window.dispatchEvent(new Event("focus")))
  assert.equal(modelRequests, 0)
  assert.equal(await chatPage.getByText("验收新模型", { exact: true }).count(), 0, "已打开页面保留旧配置")
  await chatPage.reload()
  await chatPage.locator('[contenteditable="true"]').first().waitFor()
  assert.equal(await chatPage.getByText("验收新模型", { exact: true }).count(), 0, "有效缓存不因保存而清空")
  await expireCache()
  await chatPage.reload()
  await chatPage.locator('[contenteditable="true"]').first().waitFor()
  assert.equal(await chatPage.getByText("验收新模型", { exact: true }).count(), 0, "过期首次初始化仍返回旧值")
  // 响应结束后 after 刷新；后续初始化最终取得新目录。
  for (let attempt = 0; attempt < 10; attempt++) {
    await chatPage.reload()
    await chatPage.locator('[contenteditable="true"]').first().waitFor()
    if (await chatPage.getByText("验收新模型", { exact: true }).count()) break
  }
  assert(await chatPage.getByText("验收新模型", { exact: true }).count(), "after 刷新应在响应后完成")
  assert.equal(modelRequests, 0)
  await page.goto(`${base}/thread-chat/${crypto.randomUUID()}`)
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.waitFor({ timeout: 90000 })
  await editor.fill("你好，请简短回答")
  await editor.press("Enter")
  await page.getByText("模型配置已生效。这是本地模拟上游的验收回复。", { exact: true }).waitFor({ timeout: 90000 })
  const stream = calls.find((c) => c.stream)
  assert.equal(stream.model, "brand-new-upstream-model")
  assert.equal(stream.max_tokens, 4096)
  assert.equal(stream.reasoning_effort, "high")
  assert.equal(stream.tools, undefined)
  await page.screenshot({ animations: "disabled", path: `${shots}/chat-config-applied.png` })
  const activeChat = await context.newPage()
  await activeChat.goto(page.url())
  const oldEditor = activeChat.locator('[contenteditable="true"]').first()
  await oldEditor.waitFor()
  await page.goto(`${base}/admin/models`)
  await page.getByLabel("搜索模型", { exact: true }).fill(id)
  await page.getByRole("button", { name: "验收新模型 操作", exact: true }).click()
  assert(await page.getByRole("menuitem", { name: "停用模型", exact: true }).isDisabled())
  await page.keyboard.press("Escape")
  catalog = await (await context.request.get(`${base}/api/admin/models`)).json()
  assert.equal((await context.request.post(`${base}/api/admin/models/default`, { headers: { origin: base }, data: { id: initial.defaultModelId, version: catalog.version } })).status(), 200)
  await page.getByRole("button", { name: "刷新", exact: true }).click()
  await page.getByRole("button", { name: "验收新模型 操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "停用模型", exact: true }).click()
  await page.getByText("停用", { exact: true }).waitFor()
  const beforeDisableCalls = calls.filter((c) => c.stream).length
  await oldEditor.fill("旧缓存仍应允许这一轮")
  await oldEditor.press("Enter")
  await activeChat.getByText("模型配置已生效。这是本地模拟上游的验收回复。", { exact: true }).nth(1).waitFor({ timeout: 90000 })
  assert(calls.filter((c) => c.stream).length > beforeDisableCalls)
  await expireCache()
  await oldEditor.fill("过期的第一轮仍使用旧配置")
  await oldEditor.press("Enter")
  await activeChat.getByText("模型配置已生效。这是本地模拟上游的验收回复。", { exact: true }).nth(2).waitFor({ timeout: 90000 })
  const countBeforeRejected = calls.filter((c) => c.stream).length
  await oldEditor.fill("刷新缓存后应拒绝停用模型")
  await oldEditor.press("Enter")
  await activeChat.getByText(/刷新页面并重新选择模型/).first().waitFor({ timeout: 90000 })
  assert.equal(calls.filter((c) => c.stream).length, countBeforeRejected, "失效模型不能触发上游调用")
  await activeChat.screenshot({ animations: "disabled", path: `${shots}/stale-model-rejected.png` })
  assert.equal(modelRequests, 0)
  await activeChat.close()
  await chatPage.close()
  assert.deepEqual(pageErrors, [])
  console.log("PASS 浏览器：初始化无独立请求、保存不清缓存、页面快照、过期旧值与 after 刷新、停用延迟及旧页面拒绝、管理员门禁、移动导航、真实请求参数（模拟上游）；无页面异常")
} finally {
  if (initial) {
    const response = await context.request.get(`${base}/api/admin/models`)
    const catalog = response.ok() ? await response.json() : null
    if (catalog?.defaultModelId === id) await context.request.post(`${base}/api/admin/models/default`, { headers: { origin: base }, data: { id: initial.defaultModelId, version: catalog.version } })
  }
  await context.close(); await browser.close(); upstream.close()
  await globalThis.__dbClient?.end()
}
