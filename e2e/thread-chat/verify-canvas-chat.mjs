/**
 * 画布 Phase 2（openspec: add-canvas-conversations）真实后端端到端验收。
 *
 * 前提同 verify-live：dev server 已起、MiniMax key 已配、本机有 Chromium。运行：
 *   CHROMIUM_PATH=... BASE_URL=http://localhost:4040 \
 *     node --experimental-strip-types e2e/thread-chat/verify-canvas-chat.mjs
 * （--experimental-strip-types：直接 import 产品代码的 kickoffQuestion 生成
 *   空分支 composer 预填的断言期望值。）
 *
 * 断言面（参考 playground verify10 + 本仓富文本 / LR / zoom 关注点）：
 * · 单击节点展开外挂面板（消息列表 + composer），展开零重排（其余节点坐标不变，
 *   D1 外挂面板不参与 dagre）；摘要收起；
 * · 面板内追问真实流式：user + pending 立即入树、busy 时发送键变「停止」、
 *   完成后 Markdown 结构断言（.md-body 内有结构化元素——富文本契约 D2）；
 * · 手势共处（D5）：面板内滚轮 = 列表内滚、画布 zoom 不变；空白处滚轮正常缩放；
 * · zoom 0.75 / 1.5 两档：面板内划选 → 气泡按选区视口坐标正确定位（fixed 免疫
 *   zoom），画布气泡无迷你列条（fork 不占列槽 D4）；
 * · 带问提交：新节点 + 边长出、focusNode 跟随（setCenter 后新节点整体可见、
 *   zoom 不缩小）、新节点选中展开、面板首条 = 所提问题、首答流式完成；
 * · 留空提交：新节点面板 composer 预填 kickoffQuestion()（语义同列模式）；
 * · 收起/再展开零重排（多节点下）；选中节点 zIndex 抬升盖过兄弟卡（LR 遮挡）；
 * · 列槽隔离：回列视图仅主线一列（画布 fork 不占槽），主线正文可见 fork 脚注；
 * · 双击面板不误触回列；双击节点卡回列模式（Phase 1 行为保留）。
 * 走真实模型，回复内容非确定，断言只卡结构与契约；测试树跑完自动清理。
 */
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { kickoffQuestion } from "../../app/thread-chat/net/prompt-pure.ts"

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
async function waitUntil(fn, timeout = 8000, step = 200) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true
    await sleep(step)
  }
  return fn()
}

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

let titlePosts = 0
let titleResponses = 0
page.on("request", (req) => {
  if (req.url().includes("/api/branch-title") && req.method() === "POST")
    titlePosts++
})
page.on("response", (res) => {
  if (res.url().includes("/api/branch-title")) titleResponses++
})
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))

/* ---------------- 画布通用工具 ---------------- */

/** 画布 zoom（解析 .react-flow__viewport 的 transform scale） */
const getScale = () =>
  page.evaluate(() => {
    const vp = document.querySelector(".react-flow__viewport")
    const m = /scale\(([\d.]+)\)/.exec(vp?.style.transform ?? "")
    return m ? Number(m[1]) : NaN
  })

/** 全部节点的世界坐标快照：data-id → style.transform（zoom/pan 不影响它，重排才变） */
const nodeTransforms = () =>
  page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll(".react-flow__node")).map((el) => [
        el.getAttribute("data-id"),
        el.style.transform,
      ])
    )
  )
const sameTransforms = (a, b) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, v]) => b[k] === v)

/** 画布空白点（pane 上、不压节点 / 面板 / 控件）——滚轮缩放与点空白收起用 */
const blankPoint = () =>
  page.evaluate(() => {
    const wrap = document.querySelector(".canvas-wrap")?.getBoundingClientRect()
    if (!wrap) return null
    for (let y = wrap.top + 70; y < wrap.bottom - 70; y += 36) {
      for (let x = wrap.left + 60; x < wrap.right - 60; x += 48) {
        const el = document.elementFromPoint(x, y)
        if (
          el &&
          el.closest(".react-flow__pane") &&
          !el.closest(".react-flow__node") &&
          !el.closest(".react-flow__panel") &&
          !el.closest(".react-flow__edge")
        )
          return { x, y }
      }
    }
    return null
  })

/** 在空白处滚轮把 zoom 调到 target（d3-zoom：scale' = scale·2^(−deltaY·0.002)） */
async function setZoom(target, tol = 0.04) {
  for (let i = 0; i < 14; i++) {
    const cur = await getScale()
    if (Math.abs(cur - target) <= tol) return cur
    const pt = await blankPoint()
    if (!pt) return cur
    await page.mouse.move(pt.x, pt.y)
    const dy = Math.log2(cur / target) / 0.002
    await page.mouse.wheel(0, Math.max(-480, Math.min(480, dy)))
    await sleep(140)
  }
  return getScale()
}

/** 在外挂面板的 assistant .md-body 里划选文字（needle 命中；否则挑首个 ≥minLen 的
    文本节点开头），dispatch mouseup 触发划选气泡；返回 { text, rect, iw, ih }。
    rect 必须在 mouseup 前采集：气泡弹出即聚焦输入框，Chromium 下焦点进 textarea
    会把 document selection 挪走（rect 归零），事后再读选区就测不到了 */
async function selectInPanel(needle, minLen = 8) {
  const picked = await page.evaluate(
    async ([needle, minLen]) => {
      const panel = document.querySelector(".canvas-expand")
      const bodies = panel?.querySelectorAll(".message.assistant .md-body")
      if (!bodies?.length) return null
      let target = null
      for (const md of bodies) {
        const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const t = node.textContent ?? ""
          const i = needle ? t.indexOf(needle) : -1
          if (needle && i >= 0) {
            target = { node, start: i, end: i + needle.length }
            break
          }
          if (!needle && t.trim().length >= minLen) {
            const s = t.indexOf(t.trim())
            target = { node, start: s, end: s + minLen }
            break
          }
        }
        if (target) break
      }
      if (!target) return null
      target.node.parentElement?.scrollIntoView({ block: "center" })
      await new Promise((r) => setTimeout(r, 150))
      const range = document.createRange()
      range.setStart(target.node, target.start)
      range.setEnd(target.node, target.end)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      const r = range.getBoundingClientRect() // mouseup 前采集（见函数头注）
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      return {
        text: (target.node.textContent ?? "").slice(target.start, target.end),
        rect: { left: r.left, top: r.top, bottom: r.bottom },
        iw: window.innerWidth,
        ih: window.innerHeight,
      }
    },
    [needle, minLen]
  )
  if (!picked) return null
  await page
    .locator(".tc .sel-bubble")
    .waitFor({ state: "visible", timeout: 5000 })
  await page.waitForTimeout(250) // 等 tc-pop 入场动画结束（期间 transform 偏移）
  return picked
}

/** 断言气泡定位 = 选区视口坐标推导（selection-bubble 的公式，画布 extraH=0） */
async function assertBubblePos(tag, sel) {
  const bub = await page.evaluate(() => {
    const b = document.querySelector(".sel-bubble")?.getBoundingClientRect()
    return b ? { left: b.left, top: b.top } : null
  })
  if (!bub) {
    ok(`${tag}：气泡可测量`, false)
    return
  }
  const expLeft = Math.max(10, Math.min(sel.rect.left, sel.iw - 244))
  let expTop = sel.rect.bottom + 9
  if (expTop > sel.ih - 190) expTop = Math.max(10, sel.rect.top - 172)
  ok(
    `${tag}：气泡贴选区定位正确（fixed 视口坐标）`,
    Math.abs(bub.left - expLeft) <= 2 && Math.abs(bub.top - expTop) <= 2,
    `期望 (${expLeft.toFixed(1)}, ${expTop.toFixed(1)})，实际 (${bub.left.toFixed(1)}, ${bub.top.toFixed(1)})`
  )
}

/** 等外挂面板流式完成：末条 assistant 有正文且发送键回到「发送」 */
async function waitPanelDone(timeout = 120000) {
  await page.waitForFunction(
    () => {
      const panel = document.querySelector(".canvas-expand")
      const bubbles = panel?.querySelectorAll(".message.assistant .bubble")
      const last = bubbles?.[bubbles.length - 1]
      const btn = panel?.querySelector(".cv-send")
      return (
        last &&
        (last.textContent ?? "").trim().length > 20 &&
        btn &&
        !btn.classList.contains("stop")
      )
    },
    undefined,
    { timeout }
  )
  await page.waitForTimeout(200) // 平滑打字 snap 落地
}

/* ================= 0. 列模式种子：主线真实首答（埋可划选短语） ================= */
await page.goto(`${BASE_URL}/thread-chat`, { waitUntil: "networkidle" })
ok("页面加载：.tc 壳存在", (await page.locator(".tc").count()) === 1)

const PHRASE_A = "量子纠缠现象无法用来传递任何信息"
const PHRASE_B = "贝尔不等式"
await page
  .locator(".column")
  .first()
  .locator("textarea")
  .fill(
    "请较详细地讲解量子纠缠（用小标题和无序列表组织，回复要足够长），并务必在" +
      `普通正文中（不加粗、不放进标题）原样包含这两个短语：「${PHRASE_A}」和「${PHRASE_B}」。`
  )
await page.locator(".column").first().locator("textarea").press("Enter")
await page.waitForFunction(
  () => {
    const col = document.querySelector(".tc .cols > .column")
    const bubbles = col?.querySelectorAll(".message.assistant .bubble")
    const last = bubbles?.[bubbles.length - 1]
    const btn = col?.querySelector(".composer .send")
    return (
      last &&
      (last.textContent ?? "").trim().length > 60 &&
      btn &&
      !btn.classList.contains("stop")
    )
  },
  undefined,
  { timeout: 120000 }
)
ok("主线收到真实流式回复", true)

/* ================= 1. 进画布 → 单击展开外挂面板（零重排） ================= */
await page.locator(".topbar button.mode", { hasText: "画布" }).click()
await page.waitForSelector(".react-flow__node", { timeout: 10000 })
await page.waitForTimeout(700) // fitView 结算
// 先缩到 ~0.7：单节点 fitView 时 zoom=1，卡下方展开的面板会探出视口底部
await page.locator(".react-flow__controls-zoomout").click()
await page.locator(".react-flow__controls-zoomout").click()
await page.waitForTimeout(350)

const t0 = await nodeTransforms()
await page.locator('.react-flow__node[data-id="main"]').click()
await page.waitForTimeout(350)
ok(
  "单击节点：外挂面板出现（消息列表 + composer）",
  (await page.locator(".canvas-expand").count()) === 1 &&
    (await page
      .locator('.canvas-expand .msg-list[data-list="main"] .message')
      .count()) === 2 &&
    (await page.locator(".canvas-expand .cv-composer textarea").count()) === 1
)
ok(
  "面板消息走列模式同款富文本（assistant 气泡内有 .md-body）",
  (await page
    .locator('.canvas-expand .bubble[data-role="assistant"] .md-body')
    .count()) === 1
)
ok(
  "展开时卡片摘要收起（面板已含完整末条）",
  (await page
    .locator(".react-flow__node.selected .canvas-card > .sum")
    .count()) === 0
)
{
  const t1 = await nodeTransforms()
  ok("展开零重排：节点坐标不变（面板不参与 dagre）", sameTransforms(t0, t1))
}
await page.screenshot({ path: SHOT("cc-1-expand") })

/* ================= 2. 面板内追问：真实流式 + busy 停止语义 + Markdown 结构 ================= */
const PHRASE_C = "退相干过程"
await page
  .locator(".canvas-expand .cv-composer textarea")
  .fill(
    "在画布面板里追问：请用一个小标题加一个无序列表，简述测量为何导致纠缠态坍缩，" +
      `并在普通正文中原样包含短语「${PHRASE_C}」。`
  )
await page.locator(".canvas-expand .cv-composer textarea").press("Enter")
await page.waitForTimeout(400)
ok(
  "面板发送：user + assistant 占位立即入树（共 4 条）",
  (await page.locator(".canvas-expand .msg-list .message").count()) === 4
)
ok(
  "流式期间发送键变「停止」（busy 语义同列模式）",
  (await page.locator(".canvas-expand .cv-send.stop").count()) === 1
)
await waitPanelDone()
{
  const structured = await page.evaluate(() => {
    const bodies = document.querySelectorAll(
      ".canvas-expand .message.assistant .md-body"
    )
    const md = bodies[bodies.length - 1]
    return md
      ? md.querySelectorAll("h1,h2,h3,h4,ul,ol,li,strong,code,table").length
      : 0
  })
  ok(
    "面板内首答流式完成且为 Markdown 结构（结构化元素 > 0）",
    structured > 0,
    `结构化元素 ${structured} 个`
  )
  const meta = await page
    .locator(".react-flow__node.selected .canvas-card .meta")
    .innerText()
  ok("卡片消息计数同步 = 4", meta.includes("4 条消息"), meta)
}
await page.screenshot({ path: SHOT("cc-2-panel-stream") })

/* ================= 3. 手势共处：面板内滚 ≠ 缩放，空白滚轮 = 缩放 ================= */
{
  const list = page.locator(".canvas-expand .msg-list.mini")
  const scrollable = await list.evaluate(
    (el) => el.scrollHeight > el.clientHeight + 20
  )
  ok("面板列表可滚（clamp 内滚前提成立）", scrollable)
  const st0 = await list.evaluate((el) => el.scrollTop)
  const s0 = await getScale()
  await list.hover()
  await page.mouse.wheel(0, -160)
  await sleep(250)
  const st1 = await list.evaluate((el) => el.scrollTop)
  const s1 = await getScale()
  ok(
    "面板内滚轮：列表内滚、画布 zoom 不变（nowheel）",
    st1 < st0 && Math.abs(s1 - s0) < 1e-6,
    `scrollTop ${st0}→${st1}，zoom ${s0}→${s1}`
  )
  const pt = await blankPoint()
  await page.mouse.move(pt.x, pt.y)
  await page.mouse.wheel(0, -160)
  await sleep(250)
  const s2 = await getScale()
  ok("空白处滚轮：画布正常缩放", Math.abs(s2 - s1) > 0.01, `zoom ${s1}→${s2}`)
}

/* ================= 4. zoom 0.75：面板内划选 → 气泡定位 + 无列条 ================= */
{
  const z = await setZoom(0.75)
  ok("zoom 调至 ≈0.75", Math.abs(z - 0.75) <= 0.05, `实际 ${z}`)
  const picked = await selectInPanel(PHRASE_B, 5)
  ok("zoom 0.75：面板内划选出气泡", picked !== null, picked?.text ?? "")
  if (picked) await assertBubblePos("zoom 0.75", picked)
  ok(
    "画布气泡无迷你列条（fork 不占列槽）",
    (await page.locator(".sel-bubble .slotmap").count()) === 0
  )
  ok(
    "气泡含 Phase A 输入框",
    (await page.locator(".sel-bubble .ask textarea").count()) === 1
  )
  await page.screenshot({ path: SHOT("cc-3-zoom075-bubble") })
  await page.keyboard.press("Escape")
  await sleep(200)
  ok(
    "Esc 关气泡（画布内关闭链正常）",
    (await page.locator(".sel-bubble").count()) === 0
  )
}

/* ================= 5. zoom 1.5：划选 → 带问提交 → 新节点 + 视口跟随 ================= */
const Q2 = "画布里带问开分支：它和经典关联的本质区别是什么？请用列表简答。"
{
  const z = await setZoom(1.5)
  ok("zoom 调至 ≈1.5", Math.abs(z - 1.5) <= 0.1, `实际 ${z}`)
  const picked = await selectInPanel(PHRASE_A, 8)
  ok("zoom 1.5：面板内划选出气泡", picked !== null, picked?.text ?? "")
  if (picked) await assertBubblePos("zoom 1.5", picked)
  await page.screenshot({ path: SHOT("cc-4-zoom150-bubble") })

  const nodesBefore = await page.locator(".react-flow__node").count()
  await page.locator(".sel-bubble .ask textarea").fill(Q2)
  await page.locator(".sel-bubble .ask textarea").press("Enter")
  await page.waitForFunction(
    (n) => document.querySelectorAll(".react-flow__node").length === n + 1,
    nodesBefore,
    { timeout: 8000 }
  )
  ok("带问提交：新节点长出（+1）", true)
  ok(
    "边 +1（父子边就位）",
    (await page.locator(".react-flow__edge").count()) === 1
  )
  await sleep(700) // setCenter 动画（320ms）+ 结算余量
  const selId = await page.evaluate(() =>
    document
      .querySelector(".react-flow__node.selected")
      ?.getAttribute("data-id")
  )
  ok("新节点自动选中（focusNode）", !!selId && selId !== "main", selId ?? "")
  ok(
    "仅一个外挂面板（单选语义，主线面板已收起）",
    (await page.locator(".canvas-expand").count()) === 1
  )
  const firstMsg = page
    .locator(".react-flow__node.selected .canvas-expand .msg-list .message")
    .first()
  ok(
    "新节点面板首条 = 所提问题（user 原文）",
    (await firstMsg.getAttribute("class"))?.includes("user") &&
      (await firstMsg.innerText()).includes(Q2.slice(0, 12))
  )
  const box = await page.locator(".react-flow__node.selected").boundingBox()
  const vp = page.viewportSize()
  ok(
    "setCenter 跟随：新节点卡整体在视口内",
    box &&
      box.x >= -2 &&
      box.y >= -2 &&
      box.x + box.width <= vp.width + 2 &&
      box.y + box.height <= vp.height + 2,
    box
      ? `x=${box.x.toFixed(0)} y=${box.y.toFixed(0)} w=${box.width.toFixed(0)} h=${box.height.toFixed(0)}`
      : "无 box"
  )
  const zAfter = await getScale()
  ok("跟随不缩小 zoom（max(当前, 0.85)）", zAfter >= 1.4, `zoom ${z}→${zAfter}`)
  await waitPanelDone()
  ok(
    "新分支首答在面板内流式完成（Markdown 渲染）",
    (await page.evaluate(() => {
      const bodies = document.querySelectorAll(
        ".canvas-expand .message.assistant .md-body"
      )
      const last = bodies[bodies.length - 1]
      return (last?.textContent ?? "").trim().length > 20
    })) === true
  )
  await page.screenshot({ path: SHOT("cc-5-new-node") })
}

/* 分支首答完成会触发一次异步标题生成：等它收口（避免与后续划选/存盘竞态） */
await waitUntil(() => titleResponses >= titlePosts, 30000)
await sleep(400)

/* ================= 6. 留空提交：新节点面板 composer 预填（同列模式语义） ================= */
let emptyAnchor = null
{
  // 回主线面板再划选（第二个分支也挂主线，形成同 rank 兄弟节点，供遮挡与重排断言）
  await setZoom(0.8)
  await page.locator('.react-flow__node[data-id="main"]').click()
  await page.waitForTimeout(300)
  emptyAnchor = await selectInPanel(PHRASE_C, 5)
  ok(
    "主线面板再划选（留空路径）",
    emptyAnchor !== null,
    emptyAnchor?.text ?? ""
  )
  const nodesBefore = await page.locator(".react-flow__node").count()
  await page.locator(".sel-bubble .ask textarea").press("Enter") // 留空直接回车
  await page.waitForFunction(
    (n) => document.querySelectorAll(".react-flow__node").length === n + 1,
    nodesBefore,
    { timeout: 8000 }
  )
  await sleep(700)
  const prefill = await page
    .locator(".react-flow__node.selected .canvas-expand .cv-composer textarea")
    .inputValue()
  ok(
    "留空分支：新节点面板 composer 预填 kickoffQuestion()（期望值由产品代码生成）",
    prefill === kickoffQuestion(emptyAnchor.text),
    JSON.stringify(prefill)
  )
  ok(
    "留空分支消息区为空（未自动发请求）",
    (await page
      .locator(".react-flow__node.selected .canvas-expand .msg-list .message")
      .count()) === 0
  )
}

/* ================= 7. 多节点下收起/再展开零重排 + zIndex 遮挡 ================= */
{
  const before = await nodeTransforms()
  const pt = await blankPoint()
  await page.mouse.click(pt.x, pt.y) // 点空白：取消选中 = 收起面板
  await sleep(300)
  ok("点空白收起面板", (await page.locator(".canvas-expand").count()) === 0)
  const afterCollapse = await nodeTransforms()
  ok("收起零重排：全部节点坐标不变", sameTransforms(before, afterCollapse))

  // 展开「上方的兄弟分支」：其面板向下悬垂，盖住下方兄弟卡（LR 特有遮挡面）
  const upperSibling = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('.react-flow__node:not([data-id="main"])')
    ).map((el) => ({
      id: el.getAttribute("data-id"),
      y: el.getBoundingClientRect().top,
    }))
    nodes.sort((a, b) => a.y - b.y)
    return nodes[0]?.id ?? null
  })
  ok("存在两个分支节点（兄弟同 rank）", upperSibling !== null)
  await page.locator(`.react-flow__node[data-id="${upperSibling}"]`).click()
  await sleep(300)
  const afterExpand = await nodeTransforms()
  ok("再展开零重排：全部节点坐标不变", sameTransforms(before, afterExpand))
  const zRaised = await page.evaluate(() => {
    const sel = document.querySelector(".react-flow__node.selected")
    const other = Array.from(
      document.querySelectorAll(".react-flow__node:not(.selected)")
    )[0]
    return Number(sel?.style.zIndex || 0) > Number(other?.style.zIndex || 0)
  })
  ok("选中节点 zIndex 抬升（面板盖过兄弟卡）", zRaised)
  await page.screenshot({ path: SHOT("cc-6-occlusion") })
}

/* ================= 8. 列槽隔离：回列视图布局未变 ================= */
{
  await page.locator(".topbar button.mode", { hasText: "列" }).click()
  await page.waitForSelector(".tc .cols", { timeout: 5000 })
  await sleep(300)
  const cols = await page.locator(".tc .cols > .column").count()
  ok("画布 fork 不占列槽：回列后仅主线一列", cols === 1, `实际 ${cols} 列`)
  const marks = await page.evaluate(
    () => document.querySelectorAll(".tc .cols .md-body sup.fn-mark").length
  )
  ok("画布 fork 的锚点脚注在列模式原文可见（≥2）", marks >= 2, `实际 ${marks}`)
  await page.screenshot({ path: SHOT("cc-7-columns-isolated") })
}

/* ================= 9. 双击语义：面板内不误触，节点卡回列 ================= */
{
  await page.locator(".topbar button.mode", { hasText: "画布" }).click()
  await page.waitForSelector(".react-flow__node", { timeout: 10000 })
  await page.waitForTimeout(700)
  await page.locator(".react-flow__controls-zoomout").click()
  await page.waitForTimeout(300)
  await page.locator('.react-flow__node[data-id="main"]').click()
  await page.waitForTimeout(300)
  ok(
    "重进画布：单击主线再展开",
    (await page.locator(".canvas-expand").count()) === 1
  )
  await page.locator(".canvas-expand .msg-list.mini").dblclick()
  await sleep(400)
  ok(
    "面板内双击不误触回列（仍在画布）",
    (await page.locator(".react-flow").count()) === 1
  )
  await page
    .locator('.react-flow__node[data-id="main"] .canvas-card .chead')
    .dblclick()
  await sleep(500)
  ok(
    "双击节点卡回列模式（Phase 1 行为保留）",
    (await page.locator(".react-flow").count()) === 0 &&
      (await page.locator(".tc .cols > .column").count()) >= 1
  )
}

/* ================= 10. 收尾 ================= */
ok(
  "全程无页面错误（pageerror）",
  pageErrors.length === 0,
  pageErrors.join(" | ")
)
await waitUntil(() => titleResponses >= titlePosts, 30000)
await sleep(2500) // 最后一轮防抖 PUT 落库后再删行
const ownTreeId = page.url().split("/").pop()
if (/^[0-9a-f-]{36}$/.test(ownTreeId)) {
  await page.request.delete(`${BASE_URL}/api/branch-trees/${ownTreeId}`)
  console.log(`已清理本次测试树 ${ownTreeId.slice(0, 8)}…`)
}
await browser.close()
console.log(failed ? "\n==== 存在 FAIL ====" : "\n==== 全部 PASS ====")
process.exit(failed)
