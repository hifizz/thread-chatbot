/**
 * ThreadChat 会话列表 UI 端到端验收（openspec: add-tree-list-ui）。
 *
 * 前提与 verify-persist.mjs 相同：dev server + MiniMax key + Chromium + DATABASE_URL
 * （已应用 0005 custom_title 迁移）。运行：
 *   CHROMIUM_PATH=... BASE_URL=http://localhost:4040 node e2e/thread-chat/verify-tree-list.mjs
 *
 * 断言链：SQL 直插三棵种子树 → 空树上 ⌘⇧K 打开列表（当前「未保存」条目置顶 +
 * 种子按 updated_at 降序 + 分支数徽标 + 点当前树仅关闭）→ 点击切换恢复 →
 * 内联重命名（Esc 取消 / Enter 提交乐观更新 + DB custom_title）→ **继续聊天触发
 * 防抖 PUT 后名字不被派生标题覆盖（design D1 的存在意义）** → 二段删除非当前树
 * （Esc / 点它处复位确认态 + localStorage 工作台记忆清理）→ 删除当前树跳转剩余
 * 最近一棵 + 「最近一棵」指针善后。测试树行 finally 清理。
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

/** 造一棵可被页面正常加载的最小种子树；withBranch = 主线外再挂一个分支（threadCount=2） */
function seedState(label, withBranch) {
  return {
    threads: {
      main: {
        id: "main",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: withBranch ? ["b1"] : [],
        lastActive: 1,
        messages: [
          {
            id: "m1",
            role: "user",
            text: `${label}主线首问的完整文本`,
            forks: [],
          },
          {
            id: "m2",
            role: "assistant",
            text: `${label}的回答正文，用于恢复断言。`,
            forks: withBranch
              ? [{ text: "回答正文", num: 1, threadId: "b1", depth: 1 }]
              : [],
            status: "done",
          },
        ],
      },
      ...(withBranch
        ? {
            b1: {
              id: "b1",
              parentId: "main",
              depth: 1,
              title: "回答正文",
              anchorText: "回答正文",
              forkFromMsgId: "m2",
              footnote: 1,
              children: [],
              lastActive: 2,
              messages: [],
            },
          }
        : {}),
    },
    artifacts: {},
    artifactOrder: [],
    recents: withBranch ? ["b1"] : [],
    footnoteCounter: withBranch ? 1 : 0,
    seq: 10,
    tick: 3,
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
})

try {
  // ---- 0. SQL 直插三棵种子树（A 最旧带分支 / C 居中 / B 最新） ----
  const idA = crypto.randomUUID()
  const idB = crypto.randomUUID()
  const idC = crypto.randomUUID()
  testTreeIds.push(idA, idB, idC)
  await sql`INSERT INTO branch_trees (id, title, state, updated_at) VALUES
    (${idA}, '种子甲', ${sql.json(seedState("种子甲", true))}, now() - interval '3 hours'),
    (${idC}, '种子丙', ${sql.json(seedState("种子丙", false))}, now() - interval '2 hours'),
    (${idB}, '种子乙', ${sql.json(seedState("种子乙", false))}, now() - interval '1 hour')`

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const puts = []
  page.on("request", (r) => {
    if (r.url().includes("/api/branch-trees/") && r.method() === "PUT")
      puts.push(r.url())
  })

  // ---- 1. 空树（未保存）上 ⌘⇧K 打开列表 ----
  const t0 = crypto.randomUUID()
  testTreeIds.push(t0) // 正常不会入库（空树不写库），保险起见列入清理
  await page.goto(`${BASE}/thread-chat/${t0}`, { waitUntil: "networkidle" })
  await page.keyboard.press("Meta+Shift+K")
  await page.locator(".swx.tlx").waitFor({ state: "visible", timeout: 5000 })
  ok("⌘⇧K 打开会话列表弹层", true)
  await page
    .locator(".tlx-row")
    .nth(3)
    .waitFor({ state: "visible", timeout: 5000 })
  const rows0 = await page.evaluate(() =>
    [...document.querySelectorAll(".tlx-row")].map((r) => ({
      cur: r.classList.contains("cur"),
      unsaved: !!r.querySelector(".tlx-unsaved"),
      title: r.querySelector(".t")?.textContent ?? "",
      badge: r.querySelector(".tlx-badge")?.textContent?.trim() ?? null,
      time: r.querySelector(".tlx-time")?.textContent ?? null,
    }))
  )
  // 开发库可能存有真实树，断言不假设「只有种子」：种子齐全 + 相对顺序正确即可
  const iB = rows0.findIndex((r) => r.title === "种子乙")
  const iC = rows0.findIndex((r) => r.title === "种子丙")
  const iA = rows0.findIndex((r) => r.title === "种子甲")
  ok(
    "列表含当前未保存条目 + 三棵种子",
    rows0.length >= 4 && iA > 0 && iB > 0 && iC > 0
  )
  ok(
    "当前树置顶高亮并标注「未保存」",
    rows0[0].cur && rows0[0].unsaved && rows0[0].title === "未命名对话"
  )
  ok("已保存树按 updated_at 降序（乙 → 丙 → 甲）", iB < iC && iC < iA)
  ok("分支数徽标（种子甲 ⑂ 1）", rows0[iA]?.badge === "⑂ 1")
  ok("相对时间显示", (rows0[iB]?.time ?? "").includes("小时前"))
  await page.screenshot({ path: SHOT("tree-list-open") })

  // 点当前树条目 = 仅关闭弹层，不跳转
  await page.locator(".tlx-row").first().click()
  await page.locator(".swx.tlx").waitFor({ state: "hidden", timeout: 3000 })
  ok("点当前树条目仅关闭弹层（URL 不变）", page.url().endsWith(t0))

  // ---- 2. 点击切换到种子甲：URL 跳转 + 数据恢复 ----
  await page.keyboard.press("Meta+Shift+K")
  await page.getByText("种子甲", { exact: true }).click()
  await page.waitForURL(`**/thread-chat/${idA}`, { timeout: 8000 })
  await page.waitForSelector(".tc .message.assistant", { timeout: 15000 })
  const restored = await page.evaluate(() => ({
    msgs: document.querySelector(".column")?.querySelectorAll(".message")
      .length,
    text: document.body.textContent.includes("种子甲的回答正文"),
  }))
  ok("点击切换：跳转到该树并恢复消息", restored.msgs === 2 && restored.text)

  // ---- 3. 内联重命名：Esc 取消 → Enter 提交（乐观更新 + DB custom_title） ----
  await page.keyboard.press("Meta+Shift+K")
  await page.locator(".swx.tlx").waitFor({ state: "visible", timeout: 5000 })
  const curRow = page.locator(".tlx-row.cur")
  await curRow.hover()
  await curRow.locator('.tlx-act[title="重命名"]').click()
  await page.locator(".tlx-edit").fill("不该生效的名字")
  await page.keyboard.press("Escape")
  const afterEsc = await page.evaluate(() => ({
    panelOpen: !!document.querySelector(".swx.tlx"),
    title: document.querySelector(".tlx-row.cur .t")?.textContent ?? "",
  }))
  ok(
    "重命名 Esc 取消：保留原名且弹层不被连带关闭",
    afterEsc.panelOpen && afterEsc.title === "种子甲"
  )
  await curRow.hover()
  await curRow.locator('.tlx-act[title="重命名"]').click()
  await page.locator(".tlx-edit").fill("我的调研")
  await page.keyboard.press("Enter")
  ok(
    "重命名 Enter 提交：条目就地更新（乐观）",
    (await curRow.locator(".t").textContent()) === "我的调研"
  )
  await page.waitForTimeout(500)
  const [renamed] =
    await sql`SELECT title, custom_title FROM branch_trees WHERE id = ${idA}`
  ok(
    "DB：custom_title 写入且派生 title 未被触碰（双轨）",
    renamed.custom_title === "我的调研" && renamed.title === "种子甲"
  )
  await page.keyboard.press("Escape") // 关闭弹层

  // ---- 4. D1 关键路径：继续聊天触发防抖 PUT，名字不被派生标题覆盖 ----
  await page
    .locator(".column")
    .first()
    .locator("textarea")
    .fill("请用一句话补充说明。")
  await page.locator(".column").first().locator("textarea").press("Enter")
  await page.waitForFunction(
    () => {
      const col = document.querySelector(".column")
      const b = col?.querySelectorAll(".message.assistant .bubble")
      const btn = col?.querySelector(".composer .send")
      return (
        b?.length >= 2 &&
        b[b.length - 1].textContent.trim().length > 0 &&
        btn &&
        !btn.classList.contains("stop")
      )
    },
    undefined,
    { timeout: 120000 }
  )
  await page.waitForTimeout(2200) // 过 1.5s 防抖
  ok(
    "继续聊天后发生整树 PUT",
    puts.some((u) => u.includes(idA))
  )
  const [afterPut] =
    await sql`SELECT title, custom_title FROM branch_trees WHERE id = ${idA}`
  ok(
    "PUT 只更新派生 title（取主线首问前 20 字）",
    afterPut.title === "种子甲主线首问的完整文本" && afterPut.title !== "种子甲"
  )
  ok(
    "custom_title 不被防抖 PUT 覆盖（design D1）",
    afterPut.custom_title === "我的调研"
  )
  await page.keyboard.press("Meta+Shift+K")
  await page.locator(".swx.tlx").waitFor({ state: "visible", timeout: 5000 })
  ok(
    "列表展示仍为自定义名「我的调研」",
    (await page.locator(".tlx-row.cur .t").textContent()) === "我的调研"
  )

  // ---- 5. 二段删除非当前树（种子乙）：确认态复位 + 删除 + localStorage 善后 ----
  await page.evaluate(
    ([a, b]) => {
      localStorage.setItem(`thread-chat:ui:${a}`, "{}")
      localStorage.setItem(`thread-chat:ui:${b}`, "{}")
    },
    [idA, idB]
  )
  const rowB = page.locator(".tlx-row", { hasText: "种子乙" })
  await rowB.hover()
  await rowB.locator('.tlx-act[title="删除此对话"]').click()
  await rowB
    .locator(".tlx-act.confirm")
    .waitFor({ state: "visible", timeout: 3000 })
  ok("首次点删除进入「确认删除」态", true)
  await page.keyboard.press("Escape")
  const afterConfirmEsc = await page.evaluate(() => ({
    panelOpen: !!document.querySelector(".swx.tlx"),
    confirming: !!document.querySelector(".tlx-act.confirm"),
  }))
  ok(
    "Esc 复位确认态（弹层不被连带关闭）",
    afterConfirmEsc.panelOpen && !afterConfirmEsc.confirming
  )
  await rowB.hover()
  await rowB.locator('.tlx-act[title="删除此对话"]').click()
  await page.locator(".swx-title").click() // 点它处
  ok("点它处复位确认态", !(await page.locator(".tlx-act.confirm").count()))
  await rowB.hover()
  await rowB.locator('.tlx-act[title="删除此对话"]').click()
  await rowB.locator(".tlx-act.confirm").click()
  await rowB.waitFor({ state: "detached", timeout: 5000 })
  ok("确认删除后条目从列表消失", true)
  const bRows = await sql`SELECT 1 FROM branch_trees WHERE id = ${idB}`
  ok("DB：种子乙行已删除", bRows.length === 0)
  const lsAfterB = await page.evaluate(
    ([a, b]) => ({
      uiB: localStorage.getItem(`thread-chat:ui:${b}`),
      uiA: localStorage.getItem(`thread-chat:ui:${a}`),
    }),
    [idA, idB]
  )
  ok(
    "localStorage：被删树的工作台记忆已清、当前树的保留",
    lsAfterB.uiB === null && lsAfterB.uiA !== null
  )
  ok("当前树不受影响（弹层仍在当前树上）", page.url().endsWith(idA))

  // ---- 6. 删除当前树（甲）：跳转剩余最近一棵（丙）+ 指针善后 ----
  const rowCur = page.locator(".tlx-row.cur")
  await rowCur.hover()
  await rowCur.locator('.tlx-act[title="删除此对话"]').click()
  await rowCur.locator(".tlx-act.confirm").click()
  // 共享开发库里可能存在比种子更新的真实树（用户在用/其它 e2e 留下），
  // 「剩余最近一棵」不必然是种子丙——只断言跳转链本身：离开被删树、落到某棵合法存在的树上。
  await page.waitForURL(
    (u) =>
      /\/thread-chat\/[0-9a-f-]{36}$/.test(u.toString()) &&
      !u.toString().includes(idA),
    { timeout: 8000 }
  )
  const jumpedTo = page.url().split("/").pop()
  const jumpedRows =
    await sql`SELECT 1 FROM branch_trees WHERE id = ${jumpedTo}`
  ok("删除当前树：跳转到某棵仍存在的树（跳转链生效）", jumpedRows.length === 1)
  const aRows = await sql`SELECT 1 FROM branch_trees WHERE id = ${idA}`
  ok("DB：当前树行已删除", aRows.length === 0)
  await page.waitForTimeout(2500) // 若有存盘尾巴此时也该到了
  const aResurrect = await sql`SELECT 1 FROM branch_trees WHERE id = ${idA}`
  ok("被删树未被卸载 flush 复活（抑制回写）", aResurrect.length === 0)
  const lsAfterA = await page.evaluate(
    ([a, c]) => ({
      uiA: localStorage.getItem(`thread-chat:ui:${a}`),
      last: localStorage.getItem("thread-chat:last-tree-id"),
    }),
    [idA, idC]
  )
  ok("localStorage：当前树的工作台记忆已清", lsAfterA.uiA === null)
  ok(
    "「最近一棵」指针不再指向被删树（已指向落地页）",
    lsAfterA.last !== idA && lsAfterA.last === jumpedTo
  )
  await page.screenshot({ path: SHOT("tree-list-after-delete") })
  await ctx.close()
} finally {
  // ---- 清理测试树行 ----
  await sql`DELETE FROM branch_trees WHERE id = ANY(${testTreeIds})`
  console.log(`已清理 ${testTreeIds.length} 行测试树（含已被用例删除的）`)
  await sql.end()
  await browser.close()
}
