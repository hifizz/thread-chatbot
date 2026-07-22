/**
 * ThreadChat Markdown Artifact 的浏览器链路验收（后端与持久化 API 均在浏览器层 mock）。
 *
 * 运行：
 *   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   BASE_URL=http://localhost:4040 \
 *   node e2e/thread-chat/verify-markdown-artifact.mjs
 */
import { chromium } from "playwright-core"

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const TREE_ID = "00000000-0000-4000-8000-000000000042"
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failed = false
function ok(label, condition, detail = "") {
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${label}${detail ? `（${detail}）` : ""}`
  )
  if (!condition) failed = true
}

function emptyState() {
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
        children: [],
        messages: [],
        lastActive: 1,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 1,
    tick: 1,
  }
}

function markdownSse(index) {
  const title = index === 1 ? "发布计划" : `修订版 ${index}`
  const content =
    index === 1
      ? "# 发布计划\n\n- 项目 A\n- 项目 B\n\n| 阶段 | 状态 |\n| --- | --- |\n| 开发 | 完成 |"
      : `# ${title}\n\n- 已根据后续要求更新`
  const inputText = JSON.stringify({ title, content })
  const splitAt = Math.ceil(inputText.length / 2)
  const chunks = [
    { type: "text-delta", id: `text-${index}`, delta: "\n" },
    {
      type: "tool-input-start",
      toolCallId: `call-${index}`,
      toolName: "createMarkdownArtifact",
    },
    {
      type: "tool-input-delta",
      toolCallId: `call-${index}`,
      inputTextDelta: inputText.slice(0, splitAt),
    },
    {
      type: "tool-input-delta",
      toolCallId: `call-${index}`,
      inputTextDelta: inputText.slice(splitAt),
    },
    {
      type: "tool-input-available",
      toolCallId: `call-${index}`,
      toolName: "createMarkdownArtifact",
      input: { title, content },
    },
    { type: "finish" },
  ]
  return `${chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")}data: [DONE]\n\n`
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
})
const context = await browser.newContext({
  viewport: { width: 1600, height: 950 },
})
await context.addCookies([
  {
    name: "better-auth.session_token",
    value: "thread-chat-markdown-e2e",
    url: BASE_URL,
  },
])

let persistedState = emptyState()
let chatRequestCount = 0
const chatBodies = []
const savedStates = []

await context.route("**/api/**", async (route) => {
  const request = route.request()
  const url = new URL(request.url())

  if (url.pathname === `/api/branch-trees/${TREE_ID}`) {
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ state: persistedState, customTitle: null }),
      })
      return
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON()
      persistedState = structuredClone(body.state)
      savedStates.push(structuredClone(body.state))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      })
      return
    }
  }

  if (url.pathname === "/api/branch-trees" && request.method() === "GET") {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ trees: [] }),
    })
    return
  }

  if (url.pathname === "/api/chat" && request.method() === "POST") {
    chatRequestCount++
    chatBodies.push(request.postDataJSON())
    const requestIndex = chatRequestCount

    // 第三次请求保持 pending，供页面点击“停止”；retry 的第四次请求正常产出。
    if (requestIndex === 3) {
      await sleep(6_000)
      try {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: "data: [DONE]\n\n",
        })
      } catch {
        // 浏览器 abort 后 route 已关闭，符合预期。
      }
      return
    }

    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
      body: markdownSse(requestIndex),
    })
    return
  }

  if (url.pathname === "/api/branch-title") {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ title: "Markdown 分支" }),
    })
    return
  }

  if (url.pathname === "/api/auth/get-session") {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "e2e", name: "E2E", email: "e2e@example.com" },
        session: { id: "e2e-session" },
      }),
    })
    return
  }

  if (url.pathname === "/api/billing/summary") {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ balanceMicros: 5_000_000, totalUsageMicros: 0 }),
    })
    return
  }

  await route.fulfill({
    status: 404,
    contentType: "application/json",
    body: "{}",
  })
})

const page = await context.newPage()
const pageErrors = []
page.on("pageerror", (error) => pageErrors.push(String(error)))

try {
  await page.goto(`${BASE_URL}/thread-chat/${TREE_ID}`, {
    waitUntil: "networkidle",
  })
  const composer = page.locator(".column").first().locator("textarea")

  await composer.fill("请帮我生成一个 Markdown，总结发布计划")
  await composer.press("Enter")
  const firstMessage = page.locator(".message.assistant").last()
  await firstMessage.locator(".acard").waitFor({ state: "visible" })
  ok("列视图：Markdown 卡片插入 assistant 消息", true)
  ok(
    "Artifact-only：不渲染空气泡",
    (await firstMessage.locator('.bubble[data-role="assistant"]').count()) === 0
  )
  ok(
    "卡片文案：标题、MARKDOWN、打开预览",
    (await firstMessage.textContent()).includes("发布计划") &&
      (await firstMessage.textContent()).includes("MARKDOWN") &&
      (await firstMessage.textContent()).includes("打开预览")
  )

  await firstMessage.locator(".acard").click()
  const drawer = page.locator(".art-drawer.open")
  await drawer.waitFor({ state: "visible" })
  ok("点击卡片打开右侧 Markdown 面板", (await drawer.count()) === 1)
  ok("GFM：标题渲染", (await drawer.locator(".art-body h1").count()) === 1)
  ok("GFM：列表渲染", (await drawer.locator(".art-body li").count()) === 2)
  ok("GFM：表格渲染", (await drawer.locator(".art-body table").count()) === 1)

  await page.waitForTimeout(1_900)
  ok("防抖整树保存包含 Markdown", savedStates.length > 0)
  ok(
    "持久化：kind、消息关联、来源 thread 与 tab 顺序齐全",
    persistedState.artifactOrder.length === 1 &&
      persistedState.artifacts[persistedState.artifactOrder[0]]?.kind ===
        "markdown" &&
      persistedState.artifacts[persistedState.artifactOrder[0]]
        ?.sourceThreadId === "main" &&
      persistedState.threads.main.messages.some((message) =>
        message.artifactIds?.includes(persistedState.artifactOrder[0])
      ) &&
      persistedState.threads.main.messages.every(
        (message) => message.markdownGeneration === undefined
      )
  )

  await page.reload({ waitUntil: "networkidle" })
  await page.locator(".message.assistant .acard").waitFor({ state: "visible" })
  ok("刷新：Markdown 卡片恢复", true)

  const composerAfterReload = page
    .locator(".column")
    .first()
    .locator("textarea")
  await composerAfterReload.fill("请修改刚才的 Markdown，补充验收部分")
  await composerAfterReload.press("Enter")
  await page
    .locator(".message.assistant .acard")
    .nth(1)
    .waitFor({ state: "visible" })
  const replayed = JSON.stringify(chatBodies[1]?.messages ?? [])
  ok(
    "后续请求上下文包含旧文档标题与正文",
    replayed.includes("[Markdown Artifact: 发布计划]") &&
      replayed.includes("| 开发 | 完成 |")
  )

  await page.getByRole("button", { name: /画布/ }).click()
  await page.locator('.react-flow__node[data-id="main"]').waitFor()
  await page.locator('.react-flow__node[data-id="main"]').click()
  const canvasCards = page.locator(".canvas-expand .acard")
  await canvasCards.first().waitFor({ state: "visible" })
  ok("画布：复用同一 Markdown 卡片", (await canvasCards.count()) === 2)
  ok(
    "画布 Artifact-only：不渲染空气泡",
    (await page
      .locator(".canvas-expand .message.assistant .bubble")
      .count()) === 0
  )
  await canvasCards.last().click()
  ok(
    "画布卡片可打开全局面板",
    (await page.locator(".art-drawer.open").count()) === 1
  )

  await page.locator(".art-drawer.open .art-x").click()
  await page.locator(".art-drawer.open").waitFor({ state: "hidden" })
  await page.getByRole("button", { name: /^列$/ }).click()
  const columnComposer = page.locator(".column").first().locator("textarea")
  await columnComposer.fill("开始一个可停止的请求")
  await columnComposer.press("Enter")
  const stopButton = page
    .locator(".column")
    .first()
    .locator(".composer .send.stop")
  await stopButton.waitFor({ state: "visible" })
  await stopButton.click()
  await page.getByText("已停止生成").waitFor({ state: "visible" })
  ok("停止：零输出请求进入可重试错误态", true)
  await page.getByRole("button", { name: "重试" }).last().click()
  await page
    .locator(".message.assistant .acard")
    .nth(2)
    .waitFor({ state: "visible" })
  ok("重试：重新生成 Markdown 卡片", true)

  await page.waitForTimeout(1_900)
  const dirty = structuredClone(persistedState)
  const firstAssistant = dirty.threads.main.messages.find(
    (message) => message.role === "assistant" && message.artifactIds?.length
  )
  firstAssistant.status = "streaming"
  firstAssistant.artifactIds.push("missing-artifact")
  dirty.threads.main.messages.push({
    id: "pending-empty",
    role: "assistant",
    text: "",
    forks: [],
    status: "pending",
  })
  dirty.artifacts.orphan = {
    id: "orphan",
    kind: "markdown",
    title: "孤儿 Markdown",
    content: "# 不应显示",
    sourceThreadId: "main",
  }
  dirty.artifactOrder.unshift("orphan")
  persistedState = dirty

  await page.reload({ waitUntil: "networkidle" })
  await page.locator(".message.assistant .acard").first().waitFor()
  ok(
    "sanitize：Artifact-only streaming 恢复 done 且空 pending 被删",
    (await page.locator(".typing, .caret").count()) === 0 &&
      (await page.locator('[data-msg-id="pending-empty"]').count()) === 0
  )
  ok(
    "sanitize：坏引用与孤儿 Artifact 不显示",
    (await page.getByText("孤儿 Markdown").count()) === 0 &&
      !(await page.locator(".topbar").textContent()).includes("Markdown4")
  )

  ok(
    "浏览器运行期无 pageerror",
    pageErrors.length === 0,
    pageErrors.join(" | ")
  )
} finally {
  await context.close()
  await browser.close()
}

if (failed) process.exitCode = 1
