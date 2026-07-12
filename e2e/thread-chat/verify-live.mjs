/**
 * ThreadChat（/thread-chat 分支对话页）真实后端端到端验收。
 *
 * 运行前提：
 *   1. dev server 已在 localhost:3000 跑着（pnpm dev）；
 *   2. .env.local 配好 MiniMax（MINIMAX_API_KEY / MINIMAX_BASE_URL / LLM_MODEL_ID）；
 *   3. 本机有 Chromium：优先取环境变量 CHROMIUM_PATH，否则用 playwright-core 默认发现逻辑。
 * 运行：
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e/thread-chat/verify-live.mjs
 *
 * 断言覆盖：页面加载 → 主线真实流式回复 → 划选开分支（气泡）→ 分支流式首答 →
 * 分支请求 payload 契约（继承上文 / kickoff / threadChat.anchorText / 无 system 角色 /
 * 无指令前缀折叠 / 无空 assistant）→ 主线锚点脚注出现 → 分支内追问二轮流式。
 * 走真实模型，回复内容非确定，断言只卡结构与契约。截图输出到同目录 shots/（已 gitignore）。
 */
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const here = dirname(fileURLToPath(import.meta.url))
const shotsDir = join(here, "shots")
mkdirSync(shotsDir, { recursive: true })
const SHOT = (n) => join(shotsDir, `${n}.png`)
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`)
  if (!cond) process.exitCode = 1
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })

// 记录发往 /api/chat 的 payload（校验请求契约用）
const payloads = []
page.on("request", (req) => {
  if (req.url().includes("/api/chat") && req.method() === "POST") {
    try {
      payloads.push(JSON.parse(req.postData() ?? "{}"))
    } catch {
      /* 非 JSON 忽略 */
    }
  }
})
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message))

await page.goto("http://localhost:3000/thread-chat", {
  waitUntil: "networkidle",
})
ok("页面加载：.tc 壳存在", (await page.locator(".tc").count()) === 1)

// ---- 1. 主线发消息，等真实流式回复完成 ----
const composer = page.locator(".column").first().locator("textarea")
await composer.fill(
  "用不超过五句话介绍一下量子纠缠，其中请务必包含「贝尔不等式」这个词。"
)
await composer.press("Enter")

await page.waitForSelector(".tc .message.assistant", { timeout: 20000 })
// 流式完成的判据：正文非空且发送键回到「发送」（busy 解除）
await page.waitForFunction(
  () => {
    const col = document.querySelector(".column")
    const bubbles = col?.querySelectorAll(".message.assistant .bubble")
    const last = bubbles?.[bubbles.length - 1]
    const btn = col?.querySelector(".composer .send")
    return (
      last &&
      last.textContent.trim().length > 20 &&
      btn &&
      !btn.classList.contains("stop")
    )
  },
  undefined,
  { timeout: 120000 }
)
const mainReply = await page
  .locator(".column")
  .first()
  .locator(".message.assistant .bubble")
  .last()
  .innerText()
ok("主线收到真实流式回复（>20 字）", mainReply.trim().length > 20)
ok(
  "回复包含「贝尔不等式」（可校验上下文真实来自模型）",
  mainReply.includes("贝尔不等式")
)
await page.screenshot({ path: SHOT("1-main-reply") })

// ---- 2. 划选回复文字 → 气泡 → 开分支 ----
const anchor = "贝尔不等式"
const selected = await page.evaluate((needle) => {
  const bubbles = document.querySelectorAll(
    ".column .message.assistant .bubble"
  )
  const bubble = bubbles[bubbles.length - 1]
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const i = node.textContent.indexOf(needle)
    if (i >= 0) {
      const range = document.createRange()
      range.setStart(node, i)
      range.setEnd(node, i + needle.length)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      return true
    }
  }
  return false
}, anchor)
ok("成功划选「贝尔不等式」", selected)

await page.waitForSelector(".tc .sel-bubble", { timeout: 5000 })
ok("划选气泡浮出", true)
await page.screenshot({ path: SHOT("2-selection-bubble") })
await page.getByText("开启分支讨论").click()

// ---- 分支列出现并等流式首答完成 ----
await page.waitForFunction(
  () => document.querySelectorAll(".column").length >= 2,
  undefined,
  {
    timeout: 10000,
  }
)
ok("分支列已打开", true)
await page.waitForFunction(
  () => {
    const cols = document.querySelectorAll(".column")
    const col = cols[cols.length - 1]
    const bubbles = col?.querySelectorAll(".message.assistant .bubble")
    const last = bubbles?.[bubbles.length - 1]
    const btn = col?.querySelector(".composer .send")
    return (
      last &&
      last.textContent.trim().length > 20 &&
      btn &&
      !btn.classList.contains("stop")
    )
  },
  undefined,
  { timeout: 120000 }
)
const branchReply = await page
  .locator(".column")
  .last()
  .locator(".message.assistant .bubble")
  .last()
  .innerText()
ok("分支首答已流式完成（>20 字）", branchReply.trim().length > 20)

// 锚点定位生效：主线回复里出现 fork 脚注上标
const fnCount = await page
  .locator(".column")
  .first()
  .locator(".message.assistant sup.fnote")
  .count()
ok(`主线出现锚点脚注标记（当前 ${fnCount} 个）`, fnCount >= 1)
await page.screenshot({ path: SHOT("3-branch-streamed") })

// ---- 3. 校验分支请求 payload 契约 ----
const branchPayload = payloads[payloads.length - 1]
const msgs = branchPayload?.messages ?? []
const texts = msgs.map((m) => m.parts?.[0]?.text ?? "")
ok(
  "分支请求含继承上文（主线的用户提问在 payload 里）",
  texts.some((t) => t.includes("量子纠缠"))
)
ok(
  "分支请求含 kickoff 代拟首问（围绕划选文字）",
  texts.some((t) => t.includes("请围绕我划选的这段话展开讲解"))
)
ok(
  "分支请求带 threadChat.anchorText（system 归服务端构造）",
  branchPayload?.threadChat?.anchorText === anchor
)
ok(
  "user 消息干净（不再折叠指令前缀）",
  !(msgs.find((m) => m.role === "user")?.parts?.[0]?.text ?? "").includes(
    "Markdown"
  )
)
ok(
  "payload 无 system 角色",
  msgs.every((m) => m.role !== "system")
)
ok(
  "payload 无空 assistant 消息",
  msgs.every(
    (m) => m.role !== "assistant" || (m.parts?.[0]?.text ?? "").trim() !== ""
  )
)

// ---- 4. 分支内追问（验证多轮 + kickoff 每轮重建） ----
const branchComposer = page.locator(".column").last().locator("textarea")
await branchComposer.fill("换一个通俗的比喻再解释一次。")
await branchComposer.press("Enter")
await page.waitForFunction(
  () => {
    const cols = document.querySelectorAll(".column")
    const col = cols[cols.length - 1]
    const bubbles = col?.querySelectorAll(".message.assistant .bubble")
    return (
      bubbles &&
      bubbles.length >= 2 &&
      bubbles[bubbles.length - 1].textContent.trim().length > 10
    )
  },
  undefined,
  { timeout: 120000 }
)
ok("分支内追问收到第二条流式回复", true)
await page.screenshot({ path: SHOT("4-branch-followup") })

console.log("\n--- 主线回复节选 ---\n" + mainReply.slice(0, 160))
console.log("\n--- 分支首答节选 ---\n" + branchReply.slice(0, 160))
await browser.close()
