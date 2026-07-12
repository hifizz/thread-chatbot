/**
 * ThreadChat（/thread-chat 分支对话页）真实后端端到端验收。
 *
 * 运行前提：
 *   1. dev server 已在 localhost:3000 跑着（pnpm dev）；
 *   2. .env.local 配好 MiniMax（MINIMAX_API_KEY / MINIMAX_BASE_URL / LLM_MODEL_ID）；
 *   3. 本机有 Chromium：优先取环境变量 CHROMIUM_PATH，否则用 playwright-core 默认发现逻辑。
 * 运行（默认 http://localhost:3000，可用 BASE_URL 覆盖）：
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e/thread-chat/verify-live.mjs
 *
 * 断言覆盖：页面加载 → 主线真实流式回复（富文本 Markdown：.md-body 渲染出结构化元素、
 * 无裸 Markdown 记号）→ 划选渲染后的正文开分支（气泡）→ 分支列打开但不自动发请求
 * （composer 预填代拟问题 / 消息区为空 / 2 秒内无新 /api/chat POST）→ 回车确认后 kickoff
 * 成为真实 user 气泡 + assistant 流式首答 → payload 契约（继承上文 / kickoff 以真实 user
 * 消息在 messages 里 / threadChat.anchorText / 无 system 角色 / 无指令前缀折叠 /
 * 无空 assistant）→ 主线源消息出现锚点高亮 / 脚注 → 分支内追问二轮流式。
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

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
await page.goto(`${BASE_URL}/thread-chat`, {
  waitUntil: "networkidle",
})
ok("页面加载：.tc 壳存在", (await page.locator(".tc").count()) === 1)

// ---- 1. 主线发消息，等真实流式回复完成 ----
const composer = page.locator(".column").first().locator("textarea")
await composer.fill(
  "请用小标题和分点列表，较详细地讲解量子纠缠（至少列 4 个要点），" +
    "并务必在正文中出现「贝尔不等式」这个词。"
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
// 平滑打字（useSmoothText）与「busy 解除」判据存在一帧级竞态：assistant.status 转为完成态、
// display 尚未从追赶态 snap 到完整 target 的那一帧里，「发送键回到『发送』」就已经为真——
// snap 发生在下一个 passive effect + 重渲染里，通常 <1 帧但不为 0。直接断言裸 Markdown 记号
// 会偶发命中这个半途文本（截断处若正落在 "**" 中间会误判成"未渲染"）。这里加一小段静置，
// 等 snap 的重渲染落地，不是掩盖真实回归——最终必然收敛到与 msg.text 完全一致的完整正文。
await page.waitForTimeout(150)
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

// 富文本断言：.md-body 存在、渲染出结构化元素、且正文无裸 Markdown 记号
const mdInfo = await page.evaluate(() => {
  const col = document.querySelector(".column")
  const bubbles = col?.querySelectorAll(".message.assistant .bubble")
  const last = bubbles?.[bubbles.length - 1]
  const md = last?.querySelector(".md-body")
  if (!md) return { hasMd: false }
  const structural = md.querySelector(
    "strong, em, ul, ol, h1, h2, h3, h4, code, table, blockquote"
  )
  // 裸记号只在【代码块之外】检测——<code>/<pre> 的 textContent 合法保留 ** 与 #
  // （如 Python 注释 # 或 shell 的 **），把它们算作未渲染记号会造成非确定性误报。
  const clone = md.cloneNode(true)
  clone.querySelectorAll("code, pre").forEach((n) => n.remove())
  const prose = clone.textContent || ""
  return {
    hasMd: true,
    structured: !!structural,
    // 正文（非代码）里出现 **加粗** 或行首 # 标题，才说明 Markdown 没被渲染
    raw: /\*\*/.test(prose) || /(^|\n)#{1,6}\s/.test(prose),
  }
})
ok("assistant 正文进入 .md-body（Markdown 渲染容器）", mdInfo.hasMd)
ok(
  "assistant 正文渲染出结构化元素（strong / 列表 / 标题 / 代码等）",
  mdInfo.structured === true
)
ok("assistant 正文无裸 Markdown 记号（** / 行首 #）", mdInfo.raw === false)
await page.screenshot({ path: SHOT("1-main-reply") })

// ---- 2. 划选回复文字 → 气泡 → 开分支 ----
const anchor = "贝尔不等式"
const selected = await page.evaluate(async (needle) => {
  const bubbles = document.querySelectorAll(
    ".column .message.assistant .bubble"
  )
  const bubble = bubbles[bubbles.length - 1]
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const i = node.textContent.indexOf(needle)
    if (i >= 0) {
      // 先把命中处滚进视口（模拟真实用户看着划选），气泡定位才落在可视区
      node.parentElement?.scrollIntoView({ block: "center" })
      await new Promise((r) => setTimeout(r, 120))
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
const postsBeforeFork = payloads.length
await page.getByText("开启分支讨论").click()

// ---- 分支列出现：不自动发请求，composer 预填代拟问题等用户确认 ----
await page.waitForFunction(
  () => document.querySelectorAll(".column").length >= 2,
  undefined,
  {
    timeout: 10000,
  }
)
ok("分支列已打开", true)

const kickoffExpected =
  `请围绕我划选的这段话展开讲解：「${anchor}」。` +
  "先解释它本身的含义，再讲清楚它为什么重要、常见误区与延伸，自然充分地展开。"
const branchCol = page.locator(".column").last()
const prefillValue = await branchCol.locator("textarea").inputValue()
ok("分支 composer 预填代拟问题（含锚点原文）", prefillValue === kickoffExpected)
ok(
  "分支消息区为空（未自动生成首答）",
  (await branchCol.locator(".message").count()) === 0
)
await page.waitForTimeout(2000)
ok(
  "开分支后 2 秒内无新的 /api/chat POST（不再自动发请求）",
  payloads.length === postsBeforeFork
)
await page.screenshot({ path: SHOT("3-branch-prefilled") })

// ---- 回车确认：kickoff 成为真实 user 消息，assistant 流式首答 ----
await branchCol.locator("textarea").press("Enter")
await page.waitForFunction(
  (expected) => {
    const cols = document.querySelectorAll(".column")
    const col = cols[cols.length - 1]
    const userBubble = col?.querySelector(".message.user .bubble")
    return userBubble && userBubble.textContent.trim() === expected
  },
  kickoffExpected,
  { timeout: 10000 }
)
ok("回车后代拟问题成为真实 user 气泡", true)
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

// 锚点定位生效：主线源消息在渲染后的 .md-body 上出现高亮或脚注（手绘 DOM）
await page
  .locator(
    ".column .message.assistant .md-body [data-text-anchor-mark], .column .message.assistant .md-body sup.fn-mark"
  )
  .first()
  .waitFor({ timeout: 5000 })
  .catch(() => {})
const markCount = await page
  .locator(
    ".column .message.assistant .md-body [data-text-anchor-mark], .column .message.assistant .md-body sup.fn-mark"
  )
  .count()
ok(`主线源消息出现锚点高亮 / 脚注（当前 ${markCount} 个标记）`, markCount >= 1)
await page.screenshot({ path: SHOT("4-branch-streamed") })

// ---- 3. 校验分支请求 payload 契约 ----
const branchPayload = payloads[payloads.length - 1]
const msgs = branchPayload?.messages ?? []
const texts = msgs.map((m) => m.parts?.[0]?.text ?? "")
ok(
  "分支请求含继承上文（主线的用户提问在 payload 里）",
  texts.some((t) => t.includes("量子纠缠"))
)
ok(
  "kickoff 以真实 user 消息形式在 messages 里（用户确认后入 store）",
  msgs.some((m) => m.role === "user" && m.parts?.[0]?.text === kickoffExpected)
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
await page.screenshot({ path: SHOT("5-branch-followup") })

console.log("\n--- 主线回复节选 ---\n" + mainReply.slice(0, 160))
console.log("\n--- 分支首答节选 ---\n" + branchReply.slice(0, 160))
await browser.close()
