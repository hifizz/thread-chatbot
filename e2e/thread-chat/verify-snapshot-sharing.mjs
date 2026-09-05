import assert from "node:assert/strict"
import { chromium } from "playwright-core"

// 集成环境只读验收：先用所有者 UI 创建两个测试分享，再传入其 URL。
// 可传入同一所有者的 Playwright storageState 文件，重复验证已登录阅读。
const projectUrl = process.env.SNAPSHOT_PROJECT_SHARE_URL
const artifactUrl = process.env.SNAPSHOT_ARTIFACT_SHARE_URL
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
assert.ok(projectUrl && artifactUrl && executablePath, "需要 SNAPSHOT_PROJECT_SHARE_URL、SNAPSHOT_ARTIFACT_SHARE_URL 和 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
const browser = await chromium.launch({ executablePath, headless: true })
try {
  const states = [undefined, ...(process.env.SNAPSHOT_OWNER_STORAGE_STATE ? [process.env.SNAPSHOT_OWNER_STORAGE_STATE] : [])]
  for (const storageState of states) {
    for (const width of [1440, 768, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, storageState })
      const page = await context.newPage()
      const privateWorkspace = (state) => state.origins.flatMap((origin) => origin.localStorage.filter((entry) => entry.name.startsWith("thread-chat:workspace:")).map((entry) => [origin.origin, entry.name, entry.value]))
      const workspaceBefore = privateWorkspace(await context.storageState())
      const violations = []
      page.on("request", (request) => {
        const url = new URL(request.url())
        if (url.origin === new URL(projectUrl).origin && (request.method() !== "GET" || /^\/api\/(thread-chat|chat|attachments)/.test(url.pathname))) violations.push(`${request.method()} private request`)
      })
      const response = await page.goto(projectUrl)
      assert.equal(response.status(), 200)
      assert.match(response.headers()["cache-control"], /no-store/)
      const before = await page.evaluate(() => ({ selected: [...document.querySelectorAll("select")].map((s) => s.value), slots: [...document.querySelectorAll(".cols > [data-thread-id]")].map((e) => [e.getAttribute("data-thread-id"), e.classList.contains("col-strip")]) }))
      assert.equal(await page.locator("textarea,[contenteditable=true]").count(), 0)
      assert.equal(await page.locator("img").count(), 0)
      assert.equal((await page.content()).includes("PRIVATE_SENTINEL"), false)
      const closeDocument = page.getByRole("button", { name: "关闭文档", exact: true })
      if (await closeDocument.count()) await closeDocument.click()
      const options = await page.getByRole("combobox", { name: "全部分支", exact: true }).locator("option").evaluateAll((rows) => rows.map((row) => row.value))
      for (const id of options) {
        await page.getByRole("combobox", { name: "全部分支", exact: true }).selectOption(id)
        assert.ok(await page.locator(`.column[data-thread-id="${id}"]`).count())
      }
      await page.getByRole("button", { name: "画布", exact: true }).click()
      await page.locator(".react-flow__viewport").waitFor({ state: "visible" })
      assert.equal(await page.locator("textarea,[contenteditable=true]").count(), 0)
      await page.keyboard.press("Control+Enter")
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: "恢复初始布局", exact: true }).click()
      const after = await page.evaluate(() => ({ selected: [...document.querySelectorAll("select")].map((s) => s.value), slots: [...document.querySelectorAll(".cols > [data-thread-id]")].map((e) => [e.getAttribute("data-thread-id"), e.classList.contains("col-strip")]) }))
      assert.deepEqual(after, before)
      await page.goto(artifactUrl)
      assert.equal(await page.getByRole("combobox").count(), 0)
      assert.equal(await page.locator('a[href*="/thread-chat/"],img,textarea,[contenteditable=true]').count(), 0)
      assert.deepEqual(violations, [])
      assert.deepEqual(privateWorkspace(await context.storageState()), workspaceBefore)
      await context.close()
    }
  }
  console.log("分享阅读浏览器验收通过")
} finally { await browser.close() }
