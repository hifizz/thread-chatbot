/**
 * ThreadChat 分支树 DB 持久化端到端验收（openspec: add-branch-tree-persistence）。
 *
 * 前提与 verify-live.mjs 相同（dev server + MiniMax key + Chromium），另需
 * DATABASE_URL 可连且已应用 branch_trees 迁移。运行：
 *   CHROMIUM_PATH=... BASE_URL=http://localhost:4040 node e2e/thread-chat/verify-persist.mjs
 *
 * 断言链：裸路径 replace 到 /thread-chat/{uuid} → 主线流式 + 划选开分支（回车首答）
 * → 过防抖观测整树 PUT → 同 context 重载全恢复（消息/分支列=工作台记忆/锚点/无转圈）
 * → 全新 context 直访同 URL 恢复（URL 即身份）→ 新对话空树 + 原树回访仍在
 * → DB 行断言 → sanitize（直写脏快照后加载收敛）。测试树行跑完清理。
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import postgres from "postgres"

const here = dirname(fileURLToPath(import.meta.url))
const SHOT = (n) => join(here, "shots", `${n}.png`)
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`)
  if (!cond) process.exitCode = 1
}
const BASE = process.env.BASE_URL || "http://localhost:3000"

// DATABASE_URL：优先环境变量，回退 .env.local
const env = Object.fromEntries(
  readFileSync(join(here, "../../.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ]
    })
)
const sql = postgres(process.env.DATABASE_URL || env.DATABASE_URL, { max: 1 })
const testTreeIds = []

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
})

// ---- 1. 裸路径 → replace 到 UUID URL ----
const ctx1 = await browser.newContext()
const page = await ctx1.newPage()
await page.goto(`${BASE}/thread-chat`, { waitUntil: "networkidle" })
await page.waitForURL(/\/thread-chat\/[0-9a-f-]{36}$/, { timeout: 10000 })
const treeUrl = page.url()
const treeId = treeUrl.split("/").pop()
testTreeIds.push(treeId)
ok("裸路径 replace 到 /thread-chat/{uuid}", /^[0-9a-f-]{36}$/.test(treeId))

// ---- 2. 主线发消息 → 划选开分支 → 回车首答 ----
const puts = []
page.on("request", (r) => {
  if (r.url().includes("/api/branch-trees/") && r.method() === "PUT")
    puts.push(r.url())
})
await page
  .locator(".column")
  .first()
  .locator("textarea")
  .fill("用两三句话介绍二分查找，请包含「时间复杂度」这个词。")
await page.locator(".column").first().locator("textarea").press("Enter")
await page.waitForFunction(
  () => {
    const col = document.querySelector(".column")
    const b = col?.querySelectorAll(".message.assistant .bubble")
    const btn = col?.querySelector(".composer .send")
    return (
      b?.length &&
      b[b.length - 1].textContent.trim().length > 20 &&
      btn &&
      !btn.classList.contains("stop")
    )
  },
  undefined,
  { timeout: 120000 }
)
await page.waitForTimeout(200)
const selected = await page.evaluate((needle) => {
  const md = [
    ...document.querySelectorAll(".column .message.assistant .md-body"),
  ].pop()
  const w = document.createTreeWalker(md, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) {
    const i = n.textContent.indexOf(needle)
    if (i >= 0) {
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + needle.length)
      const s = getSelection()
      s.removeAllRanges()
      s.addRange(r)
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      return true
    }
  }
  return false
}, "时间复杂度")
ok("划选「时间复杂度」", selected)
await page
  .locator(".tc .sel-bubble")
  .waitFor({ state: "visible", timeout: 5000 })
await page.waitForTimeout(300)
await page.getByText("开启分支讨论").click()
await page.waitForFunction(
  () => document.querySelectorAll(".column").length >= 2,
  undefined,
  { timeout: 8000 }
)
await page.locator(".column").last().locator("textarea").press("Enter")
await page.waitForFunction(
  () => {
    const cols = document.querySelectorAll(".column")
    const col = cols[cols.length - 1]
    const b = col?.querySelectorAll(".message.assistant .bubble")
    const btn = col?.querySelector(".composer .send")
    return (
      b?.length &&
      b[b.length - 1].textContent.trim().length > 20 &&
      btn &&
      !btn.classList.contains("stop")
    )
  },
  undefined,
  { timeout: 120000 }
)
ok("分支首答流式完成", true)

// ---- 3. 过防抖 → 整树 PUT 发生 ----
await page.waitForTimeout(2200)
ok("防抖后发生整树 PUT", puts.length >= 1)

// ---- 4. 同 context 重载：全恢复（含工作台记忆）----
await page.goto(treeUrl, { waitUntil: "networkidle" })
await page.waitForSelector(".tc .message.assistant", { timeout: 15000 })
const restored = await page.evaluate(() => ({
  cols: document.querySelectorAll(".column").length,
  mainMsgs:
    document.querySelector(".column")?.querySelectorAll(".message").length ?? 0,
  anchors: document.querySelectorAll(
    ".md-body [data-text-anchor-mark], .md-body sup.fn-mark"
  ).length,
  spinning: document.querySelectorAll(".typing, .caret").length,
}))
ok("重载：主线消息恢复", restored.mainMsgs >= 2)
ok("重载：分支列仍开着（工作台记忆）", restored.cols >= 2)
ok("重载：锚点高亮/脚注恢复", restored.anchors >= 1)
ok("重载：无 pending 转圈残留", restored.spinning === 0)
await page.screenshot({ path: SHOT("persist-restored") })
await ctx1.close()

// ---- 5. 全新 context（无 localStorage）直访同 URL ----
const ctx2 = await browser.newContext()
const p2 = await ctx2.newPage()
await p2.goto(treeUrl, { waitUntil: "networkidle" })
await p2.waitForSelector(".tc .message.assistant", { timeout: 15000 })
const fresh = await p2.evaluate(() => ({
  mainMsgs:
    document.querySelector(".column")?.querySelectorAll(".message").length ?? 0,
  anchors: document.querySelectorAll(
    ".md-body [data-text-anchor-mark], .md-body sup.fn-mark"
  ).length,
}))
ok("新 context 直访 URL：消息恢复（URL 即身份）", fresh.mainMsgs >= 2)
ok("新 context 直访 URL：锚点恢复", fresh.anchors >= 1)

// ---- 6. 新对话：空树，原树可回访 ----
await p2.getByRole("button", { name: "新对话" }).click()
await p2.waitForURL(
  (u) =>
    /\/thread-chat\/[0-9a-f-]{36}$/.test(u.toString()) &&
    !u.toString().includes(treeId),
  { timeout: 8000 }
)
testTreeIds.push(p2.url().split("/").pop())
await p2.waitForTimeout(400)
ok("新对话：空树", (await p2.locator(".message").count()) === 0)
await p2.goto(treeUrl, { waitUntil: "networkidle" })
await p2.waitForSelector(".tc .message.assistant", { timeout: 15000 })
ok("原 URL 回访：原树仍在", (await p2.locator(".message").count()) >= 2)
await ctx2.close()

// ---- 7. DB 行断言 ----
const rows =
  await sql`SELECT state, title FROM branch_trees WHERE id = ${treeId}`
ok("DB：treeId 行存在", rows.length === 1)
const threads = rows[0] ? Object.keys(rows[0].state?.threads ?? {}) : []
ok(
  "DB：state.threads 含 main + 分支",
  threads.includes("main") && threads.length >= 2
)
ok("DB：派生标题非空", !!rows[0]?.title)

// ---- 8. sanitize：直写脏快照后加载收敛 ----
const dirtyId = crypto.randomUUID()
testTreeIds.push(dirtyId)
const dirtyState = {
  threads: {
    main: {
      id: "main",
      parentId: null,
      depth: 0,
      title: "主线",
      anchorText: null,
      forkFromMsgId: null,
      footnote: null,
      children: [],
      lastActive: 2,
      messages: [
        { id: "m1", role: "user", text: "测试", forks: [] },
        {
          id: "m2",
          role: "assistant",
          text: "这是流式到一半的内容",
          forks: [],
          status: "streaming",
        },
        { id: "m3", role: "assistant", text: "", forks: [], status: "pending" },
      ],
    },
  },
  artifacts: {},
  artifactOrder: [],
  recents: [],
  footnoteCounter: 0,
  seq: 4,
  tick: 2,
}
await sql`INSERT INTO branch_trees (id, title, state) VALUES (${dirtyId}, '脏快照测试', ${sql.json(dirtyState)})`
const ctx3 = await browser.newContext()
const p3 = await ctx3.newPage()
await p3.goto(`${BASE}/thread-chat/${dirtyId}`, { waitUntil: "networkidle" })
await p3.waitForSelector(".tc .message", { timeout: 15000 })
const sane = await p3.evaluate(() => ({
  msgs: document.querySelectorAll(".message").length,
  spinning: document.querySelectorAll(".typing, .caret").length,
  lastText:
    [...document.querySelectorAll(".message.assistant .bubble")].pop()
      ?.textContent ?? "",
}))
ok("sanitize：空 pending 占位被删（3→2 条）", sane.msgs === 2)
ok(
  "sanitize：半截 streaming 以正文显示为 done",
  sane.lastText.includes("流式到一半") && sane.spinning === 0
)
await ctx3.close()

// ---- 清理测试树行 ----
await sql`DELETE FROM branch_trees WHERE id = ANY(${testTreeIds})`
console.log(`已清理 ${testTreeIds.length} 行测试树`)
await sql.end()
await browser.close()
