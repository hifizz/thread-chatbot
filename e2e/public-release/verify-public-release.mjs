/**
 * Public-release browser acceptance checks (openspec: prepare-public-release).
 *
 * Prerequisites: a running application and a Chromium executable available to
 * playwright-core. This script deliberately covers only public UI and the
 * signed-out flow. Optionally provide a pre-authenticated Playwright storage
 * state to also verify the fresh-chat UUID contract:
 *
 *   CHROMIUM_PATH=... BASE_URL=http://localhost:3000 \
 *     node e2e/public-release/verify-public-release.mjs
 *
 *   CHROMIUM_PATH=... PLAYWRIGHT_STORAGE_STATE=/safe/path/state.json \
 *     node e2e/public-release/verify-public-release.mjs
 *
 * The storage-state file is supplied by the operator and is never created,
 * modified, or logged by this script. Do not commit one to the repository.
 */
import { chromium } from "playwright-core"

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
)
const STORAGE_STATE = process.env.PLAYWRIGHT_STORAGE_STATE
const CANONICAL_REPOSITORY = "https://github.com/hifizz/thread-chatbot"
const UUID_ROUTE =
  /\/thread-chat\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i

let failed = false
function check(label, condition, detail = "") {
  const passed = Boolean(condition)
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`
  )
  if (!passed) failed = true
}

function routeUrl(pathname) {
  return new URL(pathname, `${BASE_URL}/`).toString()
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement
    return (
      Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0) >
      root.clientWidth
    )
  })
}

async function inspectLanding(page, viewport) {
  await page.setViewportSize(viewport)
  await page.goto(routeUrl("/"), { waitUntil: "networkidle" })

  const h1 = (await page.locator("h1").first().textContent())?.trim() ?? ""
  check(
    `${viewport.width}px：首页存在英文 H1`,
    h1.length > 0 && /[A-Za-z]/.test(h1) && !/[^\x00-\x7F]/.test(h1),
    h1 || "未找到 H1"
  )

  const startLinks = page.locator("a", { hasText: /^\s*Start chatting\s*$/i })
  const startCount = await startLinks.count()
  const startHrefs = await startLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href"))
  )
  check("至少存在一个 Start chatting 链接", startCount > 0)
  check(
    "所有 Start chatting 链接 href=/start-chat",
    startCount > 0 && startHrefs.every((href) => href === "/start-chat"),
    startHrefs.join(", ")
  )

  const githubLinks = page.locator('a[href*="github.com"]')
  const githubCount = await githubLinks.count()
  const githubHrefs = await githubLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href"))
  )
  check("至少存在一个 GitHub 链接", githubCount > 0)
  check(
    "所有 GitHub 链接指向 canonical repository",
    githubCount > 0 &&
      githubHrefs.every((href) => href === CANONICAL_REPOSITORY),
    githubHrefs.join(", ")
  )

  const landingText = (
    (await page.locator("body").textContent()) ?? ""
  ).toLowerCase()
  check(
    "首页不显示 AGPL 或 source-available 文案",
    !/agpl|source[-\s]?available/.test(landingText)
  )
  check(
    `${viewport.width}px：页面无横向溢出`,
    !(await hasHorizontalOverflow(page))
  )

  const primaryCta = startLinks.first()
  const box = await primaryCta.boundingBox()
  const ctaIsVisible =
    box !== null &&
    box.width > 0 &&
    box.height > 0 &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  check(`${viewport.width}px：首个 Start chatting CTA 在首屏可见`, ctaIsVisible)
}

async function verifySignedOut(browser) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(routeUrl("/start-chat"), { waitUntil: "networkidle" })
    const current = new URL(page.url())
    check(
      "未登录访问 /start-chat 最终到 sign-in",
      current.pathname === "/sign-in",
      page.url()
    )
    check(
      "sign-in redirect 参数为 /start-chat",
      current.searchParams.get("redirect") === "/start-chat",
      current.search
    )
  } finally {
    await context.close()
  }
}

async function verifyAuthenticatedFreshStarts(browser) {
  if (!STORAGE_STATE) {
    console.log(
      "SKIP  已登录两次新 UUID：未提供 PLAYWRIGHT_STORAGE_STATE（仅覆盖 signed-out 与 public UI）"
    )
    return
  }

  const context = await browser.newContext({ storageState: STORAGE_STATE })
  try {
    const page = await context.newPage()
    const treeIds = []
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.goto(routeUrl("/start-chat"), { waitUntil: "networkidle" })
      const match = new URL(page.url()).pathname.match(UUID_ROUTE)
      check(
        `已登录第 ${attempt} 次 /start-chat 到有效 UUID tree URL`,
        Boolean(match),
        page.url()
      )
      if (match) treeIds.push(match[1].toLowerCase())
    }
    check(
      "已登录连续两次 /start-chat 生成不同 UUID",
      treeIds.length === 2 && treeIds[0] !== treeIds[1]
    )
  } finally {
    await context.close()
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
})

try {
  const publicContext = await browser.newContext()
  try {
    const page = await publicContext.newPage()
    await inspectLanding(page, { width: 1440, height: 960 })
    await inspectLanding(page, { width: 390, height: 844 })
  } finally {
    await publicContext.close()
  }

  await verifySignedOut(browser)
  await verifyAuthenticatedFreshStarts(browser)
} finally {
  await browser.close()
}

if (failed) process.exitCode = 1
