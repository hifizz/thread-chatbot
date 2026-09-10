import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright-core"
import { eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { adminMembers, user } from "../../lib/db/schema.ts"
const base = process.env.BETTER_AUTH_URL
assert.equal(process.env.ADMIN_SHELL_TEST_WRITES, "1")
for (const url of [base, process.env.DATABASE_URL]) assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "只允许本地隔离验收")
assert(process.env.ADMIN_TEST_CHROMIUM, "需要本地 Chromium")
const browser = await chromium.launch({ executablePath: process.env.ADMIN_TEST_CHROMIUM, args: ["--no-sandbox", "--no-zygote", "--single-process", "--disable-dev-shm-usage", "--disable-gpu"] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
const email = `admin-shell-${crypto.randomUUID()}@example.test`
const password = crypto.randomUUID()
let account
try {
  await page.goto(`${base}/admin`)
  await page.waitForURL((url) => url.pathname === "/sign-in")
  assert.equal(new URL(page.url()).searchParams.get("redirect"), "/admin")
  const response = await context.request.post(`${base}/api/auth/sign-up/email`, {
    headers: { origin: base }, data: { name: "后台验收", email, password, role: "admin" },
  })
  assert.equal(response.status(), 200)
  account = (await response.json()).user
  assert.equal((await db.select().from(adminMembers).where(eq(adminMembers.userId, account.id))).length, 0)
  await context.request.post(`${base}/api/auth/sign-out`, { headers: { origin: base }, data: {} })
  await page.goto(`${base}/sign-in?redirect=/admin`)
  await page.getByLabel("邮箱", { exact: true }).fill(email)
  await page.getByLabel("密码", { exact: true }).fill(password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await page.waitForURL((url) => url.pathname === "/admin")
  await page.waitForLoadState("networkidle")
  assert.equal(await page.getByRole("heading", { name: "后台样板页", exact: true }).count(), 0, "普通用户不得看见后台内容")
  await page.getByText("404", { exact: true }).waitFor()
  for (let attempt = 0; attempt < 2; attempt++) {
    const grant = spawnSync(process.execPath, ["--env-file=.env.local", "--import", "tsx", "scripts/admin/grant-admin.ts", "--email", email], { encoding: "utf8" })
    assert.equal(grant.status, 0, grant.stderr)
  }
  assert.equal((await db.select().from(adminMembers).where(eq(adminMembers.userId, account.id))).length, 1)
  const unknown = spawnSync(process.execPath, ["--env-file=.env.local", "--import", "tsx", "scripts/admin/grant-admin.ts", "--email", `missing-${email}`], { encoding: "utf8" })
  assert.notEqual(unknown.status, 0)
  await page.reload()
  await page.getByRole("heading", { name: "后台样板页", exact: true }).waitFor()
  await page.getByText("暂无管理功能", { exact: true }).waitFor()
  assert.equal(await page.getByText("模型管理", { exact: true }).count(), 0)
  const shots = process.env.ADMIN_TEST_SCREENSHOTS
  if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: `${shots}/desktop.png`, fullPage: true }) }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "切换侧边栏" }).click()
  const navigation = page.locator('[data-mobile="true"]')
  await navigation.waitFor({ state: "visible" })
  await navigation.getByRole("link", { name: "后台样板页" }).click()
  await navigation.waitFor({ state: "hidden" })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  if (shots) await page.screenshot({ path: `${shots}/mobile.png`, fullPage: true })
  await db.delete(adminMembers).where(eq(adminMembers.userId, account.id))
  await page.reload()
  assert.equal(await page.getByRole("heading", { name: "后台样板页", exact: true }).count(), 0)
  await page.getByText("404", { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log("PASS 后台骨架：未登录跳转、普通用户及伪造角色拦截、脚本幂等授权、不存在账号拒绝、管理员样板页、移动导航和撤权")
} finally {
  if (account) await db.delete(user).where(eq(user.id, account.id))
  await context.close()
  await browser.close()
  await globalThis.__dbClient?.end()
}
