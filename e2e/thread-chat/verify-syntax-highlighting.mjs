/**
 * Thread Chat Shiki 浏览器验收（业务 API 在浏览器层 mock；服务端 layout 仍校验会话）。
 *
 * 运行：
 *   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   STORAGE_STATE=/path/to/authenticated-storage-state.json \
 *   BASE_URL=http://localhost:4040 \
 *   node e2e/thread-chat/verify-syntax-highlighting.mjs
 *
 * 覆盖真实 renderer，而非检查源码：稳定消息与 Artifact 的 Shiki DOM、未知语言
 * plaintext、HTML/script 文本转义、复制原文，以及高亮异步结算后的持久锚点恢复、
 * 锚点点击与正常文本选择。
 */
import { chromium } from "playwright-core"

const BASE_URL = process.env.BASE_URL || "http://localhost:4040"
const STORAGE_STATE = process.env.STORAGE_STATE
const TREE_ID = "00000000-0000-4000-8000-000000000043"
const ANCHOR_TEXT = "可点击的持久锚点"
const MESSAGE_CODE =
  "const escaped = '<script>window.__thread_message_xss = true</script>'"
const ARTIFACT_CODE =
  "console.log('<script>window.__thread_artifact_xss = true</script>')"
const SHELL_SESSION_CODE = "$ echo should-remain-plaintext"

let failed = false
function ok(label, condition, detail = "") {
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${label}${detail ? `（${detail}）` : ""}`
  )
  if (!condition) failed = true
}

function seededState() {
  return {
    threads: {
      main: {
        id: "main",
        modelId: "minimax-m2",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: ["branch-1"],
        lastActive: 2,
        messages: [
          {
            id: "message-1",
            role: "assistant",
            status: "done",
            text: `# 安全与持久锚点\n\n这里有${ANCHOR_TEXT}，用于验证异步高亮完成后仍能恢复脚注。\n\n\`\`\`ts {1}\n${MESSAGE_CODE}\n\`\`\`\n\n\`\`\`future-lang\n<script>window.__thread_unknown_xss = true</script>\n\`\`\`\n\n\`\`\`shell-session\n${SHELL_SESSION_CODE}\n\`\`\``,
            forks: [
              {
                text: ANCHOR_TEXT,
                num: 1,
                threadId: "branch-1",
                depth: 1,
                anchor: {
                  quote: { exact: ANCHOR_TEXT, prefix: "", suffix: "" },
                },
              },
            ],
            artifactIds: ["artifact-1"],
          },
        ],
      },
      "branch-1": {
        id: "branch-1",
        modelId: "minimax-m2",
        parentId: "main",
        depth: 1,
        title: "锚点分支",
        anchorText: ANCHOR_TEXT,
        forkFromMsgId: "message-1",
        footnote: 1,
        children: [],
        lastActive: 1,
        messages: [
          {
            id: "branch-message-1",
            role: "assistant",
            status: "done",
            text: "这是一条已持久化的分支回复。",
            forks: [],
          },
        ],
      },
    },
    artifacts: {
      "artifact-1": {
        id: "artifact-1",
        kind: "markdown",
        title: "含代码的静态 Artifact",
        content: `# Artifact 安全性\n\n\`\`\`js\n${ARTIFACT_CODE}\n\`\`\``,
        sourceThreadId: "main",
      },
    },
    artifactOrder: ["artifact-1"],
    recents: [],
    footnoteCounter: 1,
    seq: 4,
    tick: 2,
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
})
const context = await browser.newContext({
  viewport: { width: 1600, height: 950 },
  ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}),
})
let persistedState = seededState()

await context.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(text) {
        globalThis.__threadChatCopiedCode = text
        return Promise.resolve()
      },
    },
  })
})

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
      persistedState = structuredClone(request.postDataJSON().state)
      await route.fulfill({ contentType: "application/json", body: "{}" })
      return
    }
  }

  if (url.pathname === "/api/branch-trees" && request.method() === "GET") {
    await route.fulfill({ contentType: "application/json", body: '{"trees":[]}' })
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
      body: '{"balanceMicros":5000000,"totalUsageMicros":0}',
    })
    return
  }

  await route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
})

const page = await context.newPage()
const pageErrors = []
page.on("pageerror", (error) => pageErrors.push(String(error)))

try {
  await page.goto(`${BASE_URL}/thread-chat/${TREE_ID}`, { waitUntil: "networkidle" })
  if (new URL(page.url()).pathname === "/sign-in") {
    throw new Error(
      "Thread Chat 的服务端 layout 需要真实会话；请通过 STORAGE_STATE 提供已登录的 Playwright storage state。"
    )
  }
  const sourceMessage = page.locator('.column[data-thread-id="main"] .message.assistant')
  await sourceMessage.locator(".md-body").waitFor({ state: "visible" })
  await sourceMessage
    .locator('.md-body[data-content-settled="true"]')
    .waitFor({ state: "attached", timeout: 20_000 })

  const messageCode = sourceMessage.locator(".md-code").filter({ hasText: MESSAGE_CODE })
  const unknownCode = sourceMessage.locator(".md-code").filter({ hasText: "__thread_unknown_xss" })
  const shellSessionCode = sourceMessage
    .locator(".md-code")
    .filter({ hasText: SHELL_SESSION_CODE })
  ok("稳定消息：受支持语言在实际 renderer 中生成 Shiki DOM", (await messageCode.locator("pre.shiki").count()) === 1)
  ok("未知语言：在实际 renderer 中保留 plaintext fallback", (await unknownCode.locator("pre.shiki").count()) === 0)
  ok(
    "未知语言：fence 标签完整保留为 future-lang",
    (await unknownCode.locator(".lang").innerText()) === "future-lang"
  )
  ok(
    "shell-session：不截成 shell 且不误用 Bash 高亮",
    (await shellSessionCode.locator(".lang").innerText()) === "shell-session" &&
      (await shellSessionCode.locator("pre.shiki").count()) === 0
  )
  ok(
    "代码文本：Shiki renderer 保留原文",
    (await messageCode.locator("code").innerText()) === MESSAGE_CODE
  )
  ok(
    "安全：消息代码的 script 文本不会执行或插入 script 节点",
    await page.evaluate(() =>
      globalThis.__thread_message_xss === undefined &&
      globalThis.__thread_unknown_xss === undefined &&
      ![...document.scripts].some((script) => script.textContent?.includes("__thread_message_xss"))
    )
  )

  await messageCode.locator("button.copy").click()
  ok(
    "复制：按钮写入未变形的原始代码",
    (await page.evaluate(() => globalThis.__threadChatCopiedCode)) === MESSAGE_CODE
  )

  // 锚点的 DOM 手绘必须等 MarkdownBody 的异步 batch settled 后才发生。
  const anchorMark = sourceMessage.locator('[data-text-anchor-mark="branch-1"]')
  await anchorMark.waitFor({ state: "visible", timeout: 20_000 })
  ok("结算：高亮完成后恢复持久锚点标记与脚注", (await sourceMessage.locator("sup.fn-mark").count()) === 1)

  const selectionCreated = await page.evaluate((needle) => {
    const root = document.querySelector('.column[data-thread-id="main"] .md-body')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const index = node.textContent.indexOf(needle)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + needle.length)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      return true
    }
    return false
  }, ANCHOR_TEXT)
  await page.locator(".sel-bubble").waitFor({ state: "visible" })
  ok("交互：带 Shiki 代码的消息仍可正常划选正文", selectionCreated)
  await page.keyboard.press("Escape")

  await sourceMessage.locator("sup.fn-mark").click()
  await page.locator('.column[data-thread-id="branch-1"]').waitFor({ state: "visible" })
  ok("交互：持久锚点脚注点击仍会打开对应分支", true)

  await sourceMessage.locator(".acard").click()
  const drawer = page.locator(".art-drawer.open")
  await drawer.waitFor({ state: "visible" })
  await drawer
    .locator('.md-body[data-content-settled="true"]')
    .waitFor({ state: "attached", timeout: 20_000 })
  const artifactCode = drawer.locator(".md-code").filter({ hasText: ARTIFACT_CODE })
  ok("Artifact：静态 Markdown 同样生成 Shiki DOM", (await artifactCode.locator("pre.shiki").count()) === 1)
  ok(
    "安全：Artifact 代码的 script 文本不会执行",
    await page.evaluate(() =>
      globalThis.__thread_artifact_xss === undefined &&
      ![...document.scripts].some((script) => script.textContent?.includes("__thread_artifact_xss"))
    )
  )

  await page.reload({ waitUntil: "networkidle" })
  const reloadedSource = page.locator('.column[data-thread-id="main"] .message.assistant')
  await reloadedSource
    .locator('.md-body[data-content-settled="true"]')
    .waitFor({ state: "attached", timeout: 20_000 })
  await reloadedSource
    .locator('[data-text-anchor-mark="branch-1"]')
    .waitFor({ state: "visible", timeout: 20_000 })
  ok("刷新恢复：高亮消息的持久锚点在重新结算后再次绘制", true)
  ok("浏览器无页面运行时错误", pageErrors.length === 0, pageErrors.join(" | "))
} finally {
  await context.close()
  await browser.close()
}

process.exit(failed ? 1 : 0)
