/**
 * 气泡输入框（openspec: add-bubble-composer Phase A）真实后端端到端验收。
 *
 * 前提同 verify-live：dev server 已起、MiniMax key 已配、本机有 Chromium。运行：
 *   CHROMIUM_PATH=... BASE_URL=http://localhost:4040 \
 *     node --experimental-strip-types e2e/thread-chat/verify-bubble-composer.mjs
 * （--experimental-strip-types：直接 import 产品代码的 kickoffQuestion /
 *   defaultBranchTitle / BRANCH_TITLE_GEN_MAX_LEN 生成断言期望值。）
 *
 * 断言面（参考 playground verify6 + 本仓 IME/标题/预算关注点）：
 * · 气泡结构：输入框存在 / placeholder 提示可留空 / 弹出即聚焦；
 * · 按钮文案四态：默认 / 有输入 / ⌘ 按住 / 列条 override（含优先级与复位）；
 * · Shift+Enter 换行不提交；长问题自增高 + 内滚不自毁气泡（scroll 放行修复）；
 * · 页面真实滚动仍关气泡（放行修复无回归）；输入中 Esc 关气泡、无消息入树；
 * · IME：CDP imeSetComposition + keyCode 229 的 Enter 不提交，insertText 上屏后
 *   真实 Enter 才提交；
 * · 带问 Enter：新列第 1 条 = 该 user 消息、第 2 条 assistant 流式、composer 无预填、
 *   payload 契约（threadChat.anchorText / user 原文入 messages）；
 * · 留空 Enter：空分支 + composer 预填 kickoffQuestion() + 2 秒内无 /api/chat POST；
 * · ⌘Enter keepSource：来源列保留、新列开在紧邻右侧、首条为 user 问题；
 * · 异步分支标题：首答完成后标题变为 ≤8 字语义标题（非锚点截断）、刷新后仍在、
 *   全程 /api/branch-title 恰好请求一次；
 * · 深树继承段预算的纯函数用例在 prompt-budget.test.mjs（无需 dev server，见 README）。
 * 走真实模型，回复内容非确定，断言只卡结构与契约；测试树跑完自动清理。
 */
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { defaultBranchTitle } from "../../app/thread-chat/core/store.ts"
import { kickoffQuestion } from "../../app/thread-chat/net/prompt-pure.ts"
import { BRANCH_TITLE_GEN_MAX_LEN } from "../../constants/thread-chat.ts"

const here = dirname(fileURLToPath(import.meta.url))
const shotsDir = join(here, "shots")
mkdirSync(shotsDir, { recursive: true })
const SHOT = (n) => join(shotsDir, `${n}.png`)

let failed = 0
const ok = (label, cond, detail = "") => {
  console.log(
    `${cond ? "PASS" : "FAIL"}  ${label}${detail ? `（${detail}）` : ""}`
  )
  if (!cond) failed = 1
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** node 侧轮询等待（等 PUT 计数等非页面条件） */
async function waitUntil(fn, timeout = 8000, step = 200) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (fn()) return true
    await sleep(step)
  }
  return fn()
}

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
})
// 1920 宽 → 自适应 4 列（COL_MIN_W=430），⌘Enter keepSource 场景不触发列满替换
const page = await browser.newPage({ viewport: { width: 1920, height: 950 } })

const chatPosts = [] // /api/chat POST payload（契约断言）
const treePuts = [] // /api/branch-trees PUT（防抖存盘观测）
let titlePosts = 0 // /api/branch-title POST（「至多一次」断言）
page.on("request", (req) => {
  const url = req.url()
  if (url.includes("/api/chat") && req.method() === "POST") {
    try {
      chatPosts.push(JSON.parse(req.postData() ?? "{}"))
    } catch {
      /* 非 JSON 忽略 */
    }
  }
  if (url.includes("/api/branch-trees/") && req.method() === "PUT")
    treePuts.push(url)
  if (url.includes("/api/branch-title") && req.method() === "POST") titlePosts++
})
let titleResponses = 0 // 收尾时等标题请求收口，避免删树后被迟到的 PUT 复活
page.on("response", (res) => {
  if (res.url().includes("/api/branch-title")) titleResponses++
})
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))

/* ---------- 工具：列内划选（needle 命中单个文本节点；needle=null 时自动挑
   该列最后一条 assistant .md-body 里首个 ≥minLen 字的文本节点开头） ---------- */
async function selectInColumn(colIdx, needle, minLen = 8) {
  const picked = await page.evaluate(
    async ([colIdx, needle, minLen]) => {
      const cols = document.querySelectorAll(".tc .cols > .column")
      const col = cols[colIdx]
      const bodies = col?.querySelectorAll(".message.assistant .md-body")
      const md = bodies?.[bodies.length - 1]
      if (!md) return null
      const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT)
      let node
      let hit = null
      let fallback = null
      while ((node = walker.nextNode())) {
        const t = node.textContent ?? ""
        const i = needle ? t.indexOf(needle) : -1
        if (needle && i >= 0) {
          hit = { node, start: i, end: i + needle.length }
          break
        }
        if (!fallback && t.trim().length >= minLen) {
          const s = t.indexOf(t.trim())
          fallback = { node, start: s, end: s + minLen }
        }
      }
      const target = hit ?? fallback
      if (!target) return null
      target.node.parentElement?.scrollIntoView({ block: "center" })
      await new Promise((r) => setTimeout(r, 120))
      const range = document.createRange()
      range.setStart(target.node, target.start)
      range.setEnd(target.node, target.end)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      return (target.node.textContent ?? "").slice(target.start, target.end)
    },
    [colIdx, needle, minLen]
  )
  if (!picked) return null
  await page
    .locator(".tc .sel-bubble")
    .waitFor({ state: "visible", timeout: 5000 })
  await page.waitForTimeout(150)
  return picked
}

/** 某列（0 基，仅数展开列）流式完成：发送键回到「发送」且末条 assistant 有正文 */
async function waitColDone(colIdx, timeout = 120000) {
  await page.waitForFunction(
    (idx) => {
      const cols = document.querySelectorAll(".tc .cols > .column")
      const col = cols[idx]
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
    colIdx,
    { timeout }
  )
  await page.waitForTimeout(150) // 平滑打字 snap 落地（同 verify-live 注释）
}

/** 列消息快照：[{role, text}] */
const colMsgs = (colIdx) =>
  page.evaluate((idx) => {
    const cols = document.querySelectorAll(".tc .cols > .column")
    return Array.from(cols[idx]?.querySelectorAll(".message") ?? []).map(
      (el) => ({
        role: el.classList.contains("user") ? "user" : "assistant",
        // 正文断言只看正文：排除 .msg-quote 引用条（方向 C 的划选引用展示件）
        text: (() => {
          const b = el.querySelector(".bubble")
          if (!b) return ""
          const c = b.cloneNode(true)
          c.querySelector(".msg-quote")?.remove()
          return (c.textContent ?? "").trim()
        })(),
        quote:
          el.querySelector(".bubble .msg-quote")?.textContent?.trim() ?? null,
      })
    )
  }, colIdx)

/** 展开列标题序列（主线列头是 .ctitle.main，文本「主线」） */
const colTitles = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll(".tc .cols > .column")).map(
      (el) => el.querySelector(".ctitle")?.textContent?.trim() ?? ""
    )
  )
const colCount = () =>
  page.evaluate(() => document.querySelectorAll(".tc .cols > .column").length)

const bubbleTextarea = () => page.locator(".sel-bubble .ask textarea")
const bubbleLabel = () => page.locator(".sel-bubble > button").innerText()

/* ================= 1. 主线真实首答（正文里埋两个可划选短语） ================= */
await page.goto(`${BASE_URL}/thread-chat`, { waitUntil: "networkidle" })
ok("页面加载：.tc 壳存在", (await page.locator(".tc").count()) === 1)

const PHRASE_A = "量子纠缠现象无法用来传递任何信息" // 16 字 > 13：默认标题必带截断省略号
const PHRASE_B = "贝尔不等式"
await page
  .locator(".column")
  .first()
  .locator("textarea")
  .fill(
    "请较详细地讲解量子纠缠（小标题 + 分点），并务必在普通正文中（不加粗、不放进标题）" +
      `原样包含这两个短语：「${PHRASE_A}」和「${PHRASE_B}」。`
  )
await page.locator(".column").first().locator("textarea").press("Enter")
await waitColDone(0)
ok("主线收到真实流式回复", true)

/* ================= 2. 气泡结构 + 文案态（默认/有输入）+ 键位守卫 ================= */
let anchorA = await selectInColumn(0, PHRASE_A, 16)
ok("划选主线正文（气泡浮出）", anchorA !== null, anchorA ?? "")
ok("气泡含输入框", (await bubbleTextarea().count()) === 1)
ok(
  "输入框 placeholder 提示可留空",
  ((await bubbleTextarea().getAttribute("placeholder")) ?? "").includes("留空")
)
ok(
  "弹出即聚焦输入框",
  await page.evaluate(
    () => document.activeElement?.closest?.(".sel-bubble .ask") != null
  )
)
ok("空输入按钮文案 = 开启分支讨论", (await bubbleLabel()) === "开启分支讨论")
await bubbleTextarea().pressSequentially("测")
ok("有输入时文案 = 带着问题开分支", (await bubbleLabel()) === "带着问题开分支")
await bubbleTextarea().fill("")
ok("清空后文案恢复 = 开启分支讨论", (await bubbleLabel()) === "开启分支讨论")
await page.screenshot({ path: SHOT("bc-1-bubble-input") })

/* —— Shift+Enter 换行不提交 —— */
await bubbleTextarea().pressSequentially("第一行")
await bubbleTextarea().press("Shift+Enter")
await bubbleTextarea().pressSequentially("第二行")
await page.waitForTimeout(150)
{
  const stillOpen = (await page.locator(".sel-bubble").count()) === 1
  const val = await bubbleTextarea().inputValue()
  ok(
    "Shift+Enter 换行不提交（气泡仍开、值含换行）",
    stillOpen && val.includes("\n") && (await colCount()) === 1
  )
}

/* —— 长问题自增高 + textarea 内滚：气泡不自毁、输入不丢（scroll 放行修复） —— */
const LONG_Q = "这个问题很长，".repeat(20)
await bubbleTextarea().fill(LONG_Q)
{
  const h = await bubbleTextarea().evaluate((ta) => ta.clientHeight)
  ok(`长问题触发自增高（clamp 68px，当前 ${h}px）`, h >= 60 && h <= 72)
  await bubbleTextarea().evaluate((ta) => {
    ta.scrollTop = ta.scrollHeight // 触发气泡内部 scroll（capture 监听必须放行）
  })
  await page.waitForTimeout(200)
  const stillOpen = (await page.locator(".sel-bubble").count()) === 1
  const val = await bubbleTextarea().inputValue()
  ok("textarea 内滚后气泡不自毁、输入完整保留", stillOpen && val === LONG_Q)
  await page.screenshot({ path: SHOT("bc-2-long-question") })
}

/* —— 输入中 Esc：走壳层关闭链关气泡，无消息入树 —— */
const postsBeforeEsc = chatPosts.length
await page.keyboard.press("Escape")
await page.waitForTimeout(200)
ok(
  "输入中 Esc 关气泡、无新列、无 /api/chat 请求",
  (await page.locator(".sel-bubble").count()) === 0 &&
    (await colCount()) === 1 &&
    chatPosts.length === postsBeforeEsc
)

/* —— 放行修复无回归：页面（消息列表）真实滚动仍关气泡 —— */
anchorA = await selectInColumn(0, PHRASE_A, 16)
ok("重新划选（回归用）", anchorA !== null)
await page.evaluate(() => {
  const list = document.querySelector(".tc .msg-list")
  list.scrollTop = Math.max(0, list.scrollTop - 120)
})
await page.waitForTimeout(250)
ok(
  "页面滚动仍关闭气泡（放行只对气泡内部生效）",
  (await page.locator(".sel-bubble").count()) === 0
)

/* ================= 3. IME 组合态守卫 + 带问 Enter 开分支 ================= */
anchorA = await selectInColumn(0, PHRASE_A, 16)
ok("划选（带问路径）", anchorA !== null, anchorA ?? "")
const cdp = await page.context().newCDPSession(page)
await cdp.send("Input.imeSetComposition", {
  text: "wenti",
  selectionStart: 5,
  selectionEnd: 5,
})
// 组合态回车：真实 IME 里这次 keydown 的 keyCode 是 229（isComposing 同时为 true）
await cdp.send("Input.dispatchKeyEvent", {
  type: "rawKeyDown",
  key: "Enter",
  code: "Enter",
  windowsVirtualKeyCode: 229,
  nativeVirtualKeyCode: 229,
})
await cdp.send("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "Enter",
  code: "Enter",
})
await page.waitForTimeout(250)
ok(
  "IME 组合态 Enter 不提交（气泡仍开、无新列）",
  (await page.locator(".sel-bubble").count()) === 1 && (await colCount()) === 1
)
await cdp.send("Input.insertText", { text: "问题" }) // 上屏（提交组合文本）
await page.waitForTimeout(150)
{
  const val = await bubbleTextarea().inputValue()
  ok(
    "insertText 上屏后输入框为已上屏文本（无组合残留）",
    val.includes("问题") && !val.includes("wenti"),
    JSON.stringify(val)
  )
}

const Q1 =
  "它为什么不能用来传递信息？请通俗解释，并在回答的普通正文中原样包含短语「超光速通信不可行」。"
await bubbleTextarea().fill(Q1)
const postsBeforeQ1 = chatPosts.length
await bubbleTextarea().press("Enter")
await page.waitForFunction(
  () => document.querySelectorAll(".tc .cols > .column").length >= 2,
  undefined,
  { timeout: 10000 }
)
ok("带问 Enter：分支列打开", true)
{
  const msgs = await colMsgs(1)
  ok(
    "新列第 1 条 = 所输入问题（user 原文）",
    msgs[0]?.role === "user" && msgs[0].text === Q1,
    JSON.stringify(msgs[0] ?? null)
  )
  ok(
    "新列第 1 条带划选引用条（方向 C）",
    msgs[0]?.quote === anchorA,
    JSON.stringify(msgs[0]?.quote ?? null)
  )
  ok("新列第 2 条 = assistant（流式首答已就位）", msgs[1]?.role === "assistant")
  const composerVal = await page
    .locator(".tc .cols > .column")
    .nth(1)
    .locator(".composer textarea")
    .inputValue()
  ok("带问路径 composer 无预填", composerVal === "")
  await waitUntil(() => chatPosts.length > postsBeforeQ1, 5000)
  const payload = chatPosts[chatPosts.length - 1]
  const msgsInPayload = payload?.messages ?? []
  ok(
    "payload 契约：threadChat.anchorText = 划选原文",
    payload?.threadChat?.anchorText === anchorA
  )
  // 锚点 grounding 契约：分支首条 user 在发送线上加「就我划选的这段话」前缀
  // （裸问题的指代会被模型就近解析到上文结尾——用户实测踩过），UI 仍显示原文
  const grounded = `就我划选的这段话：「${anchorA}」——${Q1}`
  ok(
    "payload 契约：分支首问带锚点 grounding 前缀（仅发送线）",
    msgsInPayload.some(
      (m) => m.role === "user" && m.parts?.[0]?.text === grounded
    )
  )
  const ui = await page.evaluate(() => {
    const cols = document.querySelectorAll(".tc .cols > .column")
    const bubble = cols[1]?.querySelector(".message.user .bubble")
    const quote = bubble?.querySelector(".msg-quote")?.textContent?.trim() ?? ""
    const clone = bubble?.cloneNode(true)
    clone?.querySelector(".msg-quote")?.remove()
    return { quote, text: clone?.textContent?.trim() ?? "" }
  })
  ok("UI 契约：user 气泡正文 = 原始问题（无前缀）", ui.text === Q1)
  ok("UI 契约：气泡内引用条 = 划选原文（方向 C）", ui.quote === anchorA)
  // 方向 C 的核心承诺：绑定关系是数据——刷新后引用条仍在（quote 随整树 JSON 落库）
  await page.waitForTimeout(2000) // 过防抖存库
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForSelector(".tc .message.user .bubble", { timeout: 15000 })
  const afterReload = await page.evaluate(() => {
    const cols = document.querySelectorAll(".tc .cols > .column")
    for (const col of cols) {
      const q = col.querySelector(".message.user .bubble .msg-quote")
      if (q) return q.textContent?.trim() ?? ""
    }
    // 分支列可能未在恢复布局里展开：全 DOM 兜底找
    return (
      document
        .querySelector(".message.user .bubble .msg-quote")
        ?.textContent?.trim() ?? ""
    )
  })
  ok(
    "持久化契约：刷新后引用条仍在（quote 是数据不是代码行为）",
    afterReload === anchorA
  )
}
await page.screenshot({ path: SHOT("bc-3-question-branch") })
await waitColDone(1)
const branchReply = await page.evaluate(() => {
  const cols = document.querySelectorAll(".tc .cols > .column")
  const bubbles = cols[1]?.querySelectorAll(".message.assistant .bubble")
  return bubbles?.[bubbles.length - 1]?.textContent ?? ""
})
ok("带问分支首答流式完成", branchReply.trim().length > 20)

/* ================= 4. 异步分支标题：首答完成 → 语义标题 → 刷新仍在 ================= */
const DEFAULT_TITLE_A = defaultBranchTitle(anchorA)
const titleChanged = await page
  .waitForFunction(
    (dft) => {
      const cols = document.querySelectorAll(".tc .cols > .column")
      const t = cols[1]?.querySelector(".ctitle")?.textContent?.trim()
      return !!t && t !== dft
    },
    DEFAULT_TITLE_A,
    { timeout: 60000 }
  )
  .then(() => true)
  .catch(() => false)
const genTitle = (await colTitles())[1]
ok(
  `分支标题异步变为语义标题（非锚点截断）：「${genTitle}」`,
  titleChanged && genTitle !== DEFAULT_TITLE_A && !genTitle.endsWith("…")
)
ok(
  `语义标题长度 ≤ ${BRANCH_TITLE_GEN_MAX_LEN} 字`,
  titleChanged &&
    genTitle.length >= 2 &&
    genTitle.length <= BRANCH_TITLE_GEN_MAX_LEN
)
// 标题变更随整树防抖存盘（1.5s）：必须等「标题变更之后」的那次 PUT——
// 首答完成本身也会触发一次 PUT（标题请求彼时还在飞），拿它当依据会在
// 带标题的 PUT 落库前刷新，DB 里还是默认标题（本脚本首版踩过的竞态）
const putsAtTitleChange = treePuts.length
ok(
  "标题变更触发防抖整树 PUT",
  await waitUntil(() => treePuts.length > putsAtTitleChange, 8000)
)
await sleep(800) // 等 PUT 响应落库
const treeUrl = page.url()
await page.goto(treeUrl, { waitUntil: "networkidle" })
await page.locator(".tc .cols > .column").nth(1).waitFor({ timeout: 10000 })
{
  const titles = await colTitles()
  ok(
    "刷新后语义标题仍在（随树持久化）",
    titleChanged && titles[1] === genTitle,
    JSON.stringify(titles)
  )
}
await sleep(2500) // 「至多一次」：重载后不应因既有语义标题再次请求
ok(
  "全程 /api/branch-title 恰好请求一次",
  titlePosts === 1,
  `实际 ${titlePosts}`
)
await page.screenshot({ path: SHOT("bc-4-async-title") })

/* ================= 5. 留空 Enter = 现有预填流原样保留 ================= */
const anchorB = await selectInColumn(0, PHRASE_B, 6)
ok("划选（留空路径）", anchorB !== null, anchorB ?? "")
const postsBeforeEmpty = chatPosts.length
await bubbleTextarea().press("Enter") // 留空直接回车
await page.waitForFunction(
  () => document.querySelectorAll(".tc .cols > .column").length >= 3,
  undefined,
  { timeout: 10000 }
)
{
  const emptyColIdx = 2
  const prefill = await page
    .locator(".tc .cols > .column")
    .nth(emptyColIdx)
    .locator(".composer textarea")
    .inputValue()
  ok(
    "留空分支 composer 预填 kickoffQuestion()（期望值由产品代码生成）",
    prefill === kickoffQuestion(anchorB),
    JSON.stringify(prefill)
  )
  const msgs = await colMsgs(emptyColIdx)
  ok("留空分支消息区为空（未自动发请求）", msgs.length === 0)
  await sleep(2000)
  ok(
    "留空开分支 2 秒内无新 /api/chat POST",
    chatPosts.length === postsBeforeEmpty
  )
}
await page.screenshot({ path: SHOT("bc-5-empty-prefill") })

/* ================= 6. 文案四态（override / ⌘）+ ⌘Enter keepSource ================= */
// 在带问分支（第 2 列）的首答里划选：优先埋好的短语，缺失则退回自动挑选
const anchorC =
  (await selectInColumn(1, "超光速通信不可行", 8)) ??
  (await selectInColumn(1, null, 8))
ok("在带问分支列内划选（keepSource 用）", anchorC !== null, anchorC ?? "")
await bubbleTextarea().pressSequentially("对比一下？")
ok("有输入 → 带着问题开分支", (await bubbleLabel()) === "带着问题开分支")
// 新契约（用户定稿）：按钮只表达动作、两态恒定；放置后果在 .place-hint 提示行
const placeHint = async () =>
  await page
    .locator(".sel-bubble .place-hint")
    .innerText()
    .catch(() => "")
await page.keyboard.down("Meta")
ok(
  "⌘ 按住：按钮文案不变（动作恒定）",
  (await bubbleLabel()) === "带着问题开分支"
)
ok(
  "⌘ 按住：提示行 = 保留本列·右侧新开",
  (await placeHint()).includes("保留本列")
)
await page.keyboard.up("Meta")
{
  // 列条 override（点非来源、未折叠小格）：后果进提示行，按钮不变
  const cell = page.locator(
    ".sel-bubble .smcell:not(.main):not(.src):not(.ghost):not(.folded)"
  )
  ok("气泡含迷你列条（≥1 个可点小格）", (await cell.count()) >= 1)
  const hintBefore = await placeHint()
  ok(
    "默认态提示行说明放置后果（替换/折叠/新开）",
    /将?(默认)?(替换|折叠|新开)/.test(hintBefore),
    hintBefore
  )
  await cell.first().click()
  const ovHint = await placeHint()
  ok(
    "override 态提示行 = 将替换/折叠『列名』",
    /^将(替换|折叠)『.+』$/.test(ovHint),
    ovHint
  )
  ok(
    "override 态按钮文案不变（动作恒定）",
    (await bubbleLabel()) === "带着问题开分支"
  )
  await cell.first().click() // 再点同格取消
  ok("取消 override → 提示行回落默认态", (await placeHint()) === hintBefore)
}
const Q2 = "把它和经典信道对比一下？"
await bubbleTextarea().fill(Q2)
const titlesBeforeMeta = await colTitles()
await page.keyboard.press("Meta+Enter")
await page.waitForFunction(
  (n) => document.querySelectorAll(".tc .cols > .column").length === n + 1,
  titlesBeforeMeta.length,
  { timeout: 10000 }
)
{
  const titles = await colTitles()
  ok(
    "⌘Enter：来源列保留（第 2 列标题不变）",
    titles[1] === titlesBeforeMeta[1],
    JSON.stringify(titles)
  )
  ok(
    "⌘Enter：新列开在来源紧邻右侧且标题取锚点",
    titles[2] === defaultBranchTitle(anchorC),
    `期望「${defaultBranchTitle(anchorC)}」，实际「${titles[2]}」`
  )
  const msgs = await colMsgs(2)
  ok(
    "⌘Enter 新列第 1 条 = user 问题（带问 + keepSource 组合成立）",
    msgs[0]?.role === "user" && msgs[0].text === Q2
  )
}
await page.screenshot({ path: SHOT("bc-6-meta-enter") })

/* ================= 7. 收尾：停掉在飞流、清理测试树 ================= */
{
  const stopBtn = page
    .locator(".tc .cols > .column")
    .nth(2)
    .locator(".composer .send.stop")
  if ((await stopBtn.count()) > 0) await stopBtn.click()
}
ok(
  "全程无页面错误（pageerror）",
  pageErrors.length === 0,
  pageErrors.join(" | ")
)
// 若停止时已有正文（finish→done），标题请求会随即发出：等它收口 + 防抖 PUT 落库
// 再删行，否则迟到的标题 PUT 会把刚删的 DB 行复活
await sleep(500)
await waitUntil(() => titleResponses >= titlePosts, 30000)
await sleep(2500) // 让最后一轮防抖 PUT 落库，再删行（写链保证 DELETE 排最后）
const ownTreeId = page.url().split("/").pop()
if (/^[0-9a-f-]{36}$/.test(ownTreeId)) {
  await page.request.delete(`${BASE_URL}/api/branch-trees/${ownTreeId}`)
  console.log(`已清理本次测试树 ${ownTreeId.slice(0, 8)}…`)
}
await browser.close()
console.log(failed ? "\n==== 存在 FAIL ====" : "\n==== 全部 PASS ====")
process.exit(failed)
