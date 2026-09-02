/**
 * Attachment Composer Demo 浏览器验收。
 *
 * 脚本会临时创建一个不经过登录门禁的本地测试路由，执行 Next.js build，
 * 再把静态 HTML 与本地构建资源直接装入 Chromium。这样不需要监听端口，也不会
 * 依赖数据库会话。验收后删除临时路由；正式 Demo 仍由 thread-chat layout 保护。
 * 测试路由文件若已存在，脚本会拒绝覆盖。
 *
 * 可通过 CHROMIUM_PATH 指定 Chromium；未指定时使用 playwright-core 的默认位置。
 */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "playwright-core"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")
const routeName = "thread-chat-gate-3-harness/attachment-composer-demo-e2e"
const routeDirectory = join(repositoryRoot, "app", routeName)
const routeFile = join(routeDirectory, "page.tsx")
const routeSource = `"use client"

import { useState } from "react"
import { AttachmentComposerDemo } from "../../thread-chat/chat/composer/attachment-composer-demo"
import type { DemoAttachment } from "../../thread-chat/chat/composer/attachment-composer-demo-model"

export default function AttachmentComposerE2EPage() {
  const [attachments, setAttachments] = useState<DemoAttachment[]>([])
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto w-full max-w-xl">
        <AttachmentComposerDemo
          attachments={attachments}
          onChange={(next) => {
            setAttachments(next)
            console.log("attachments changed", next)
          }}
        />
      </div>
    </main>
  )
}
`

async function buildTestRoute() {
  const output = []
  const buildProcess = spawn(
    process.execPath,
    [join(repositoryRoot, "node_modules/next/dist/bin/next"), "build"],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        BETTER_AUTH_SECRET: "attachment-composer-demo-e2e-secret-2026",
        BETTER_AUTH_URL: "https://attachment-composer.test",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  const recordOutput = (chunk) => {
    output.push(chunk.toString())
    if (output.length > 200) output.shift()
  }
  buildProcess.stdout.on("data", recordOutput)
  buildProcess.stderr.on("data", recordOutput)

  await new Promise((resolve, reject) => {
    buildProcess.once("error", reject)
    buildProcess.once("close", (code) => {
      if (code === 0) resolve()
      else
        reject(new Error(`Next.js 测试构建失败（${code}）\n${output.join("")}`))
    })
  })
}

function isForbiddenRequest(request) {
  const url = new URL(request.url())
  const pathname = url.pathname.toLowerCase()
  return (
    pathname === "/api/chat" ||
    pathname.startsWith("/api/attachments") ||
    pathname.includes("ingest") ||
    request.method() === "PUT" ||
    request.method() === "DELETE"
  )
}

async function dispatchFiles(page, kind, files, text = "") {
  return page.locator('[data-testid="attachment-composer-demo"]').evaluate(
    (shell, payload) => {
      const transfer = new DataTransfer()
      for (const file of payload.files) {
        transfer.items.add(
          new File([file.body], file.name, { type: file.type })
        )
      }
      if (payload.text) transfer.setData("text/plain", payload.text)

      if (payload.kind === "drop") {
        shell.dispatchEvent(
          new DragEvent("dragenter", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        )
        shell.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        )
        return shell.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        )
      }

      return shell.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        })
      )
    },
    { kind, files, text }
  )
}

async function dispatchTextPaste(page, text) {
  return page
    .locator('[data-testid="attachment-composer-textarea"]')
    .evaluate((textarea, pastedText) => {
      const transfer = new DataTransfer()
      transfer.setData("text/plain", pastedText)
      return textarea.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        })
      )
    }, text)
}

let browser

try {
  await mkdir(routeDirectory, { recursive: true })
  await writeFile(routeFile, routeSource, { encoding: "utf8", flag: "wx" })
  await buildTestRoute()

  const html = await readFile(
    join(repositoryRoot, ".next/server/app", `${routeName}.html`),
    "utf8"
  )
  const demoUrl = `https://attachment-composer.test/${routeName}`

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
  })
  const context = await browser.newContext({
    viewport: { width: 640, height: 900 },
  })
  const page = await context.newPage()
  const forbiddenRequests = []
  const attachmentLogs = []
  const browserErrors = []
  await page.route("https://attachment-composer.test/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === `/${routeName}`) {
      await route.fulfill({ body: html, contentType: "text/html" })
      return
    }
    const prefix = "/_next/static/"
    if (!url.pathname.startsWith(prefix)) {
      await route.abort()
      return
    }
    const assetPath = decodeURIComponent(url.pathname.slice(prefix.length))
    if (!assetPath || assetPath.split("/").includes("..")) {
      await route.abort()
      return
    }
    await route.fulfill({
      path: join(repositoryRoot, ".next/static", assetPath),
    })
  })
  page.on("request", (request) => {
    if (isForbiddenRequest(request)) {
      forbiddenRequests.push(`${request.method()} ${request.url()}`)
    }
  })
  page.on("console", (message) => {
    if (message.text().startsWith("attachments changed")) {
      attachmentLogs.push(message.text())
    }
    if (message.type() === "error") browserErrors.push(message.text())
  })
  page.on("pageerror", (error) => browserErrors.push(error.message))
  page.on("requestfailed", (request) =>
    browserErrors.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText}`
    )
  )

  await page.goto(demoUrl, { waitUntil: "networkidle" })
  const input = page.locator('[data-testid="attachment-file-input"]')
  const items = page.locator('[data-testid="attachment-item"]')
  const textarea = page.locator('[data-testid="attachment-composer-textarea"]')
  assert.equal(
    await input.count(),
    1,
    `测试页面未完成 hydration：${browserErrors.join("\n") || (await page.locator("body").innerText())}`
  )
  await page.waitForTimeout(500)
  assert.deepEqual(browserErrors, [], "测试页面存在浏览器错误")
  assert.ok(
    await input.evaluate((element) =>
      Object.keys(element).some((key) => key.startsWith("__reactProps$"))
    ),
    "测试页面未完成 React hydration"
  )

  await input.setInputFiles([
    { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("1") },
    { name: "two.md", mimeType: "text/markdown", buffer: Buffer.from("2") },
    { name: "three.png", mimeType: "image/png", buffer: Buffer.from("3") },
  ])
  await assertCount(items, 3, "multi-select 应一次加入全部文件")

  await input.setInputFiles({
    name: "one.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("1"),
  })
  await assertCount(items, 4, "清空 input.value 后应可再次选择同名文件")

  await dispatchFiles(page, "drop", [
    { name: "drop-a.txt", type: "text/plain", body: "a" },
    { name: "drop-b.txt", type: "text/plain", body: "b" },
  ])
  await assertCount(items, 6, "Drop 应一次加入多个文件")

  const filePasteDefaultAllowed = await dispatchFiles(
    page,
    "paste",
    [{ name: "clipboard.png", type: "image/png", body: "image" }],
    "不应生成文本附件"
  )
  assert.equal(filePasteDefaultAllowed, false, "文件 Paste 应 preventDefault")
  await assertCount(items, 7, "混合 Clipboard 应只生成文件附件")

  const textPasteDefaultAllowed = await dispatchTextPaste(
    page,
    "  pasted line 1\npasted line 2  "
  )
  assert.equal(textPasteDefaultAllowed, false, "文本 Paste 应 preventDefault")
  await assertCount(items, 8, "文本 Paste 应生成一个 synthetic .txt")
  assert.match(await items.last().innerText(), /pasted-text-\d+\.txt/)

  const blankPasteDefaultAllowed = await dispatchTextPaste(page, " \n\t ")
  assert.equal(blankPasteDefaultAllowed, true, "空白 Paste 不应被接管")
  await assertCount(items, 8, "空白 Paste 不应创建附件")

  await items.nth(2).locator('[data-testid="remove-attachment"]').click()
  await assertCount(items, 7, "Remove 应只删除目标附件")

  await textarea.fill("普通逐字输入不会创建附件")
  assert.equal(await textarea.inputValue(), "普通逐字输入不会创建附件")
  await assertCount(items, 7, "普通输入不应改变附件")

  await input.setInputFiles(
    Array.from({ length: 12 }, (_, index) => ({
      name: `overflow-${index}-${"long-name-".repeat(3)}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(String(index)),
    }))
  )
  await assertCount(items, 19, "10+ 附件应全部保留")
  const trayLayout = await page
    .locator('[data-testid="attachment-tray"]')
    .evaluate((tray) => ({
      clientWidth: tray.clientWidth,
      scrollWidth: tray.scrollWidth,
      topPositions: Array.from(tray.children).map((child) =>
        Math.round(child.getBoundingClientRect().top)
      ),
    }))
  assert.ok(
    trayLayout.scrollWidth > trayLayout.clientWidth,
    "Attachment Tray 应产生自身横向溢出"
  )
  assert.equal(
    new Set(trayLayout.topPositions).size,
    1,
    "Attachment Item 应保持单行"
  )

  assert.equal(forbiddenRequests.length, 0, forbiddenRequests.join("\n"))
  assert.equal(
    attachmentLogs.length,
    7,
    "每次有效 Picker/Drop/Paste/Remove 应只触发一次 onChange"
  )

  await context.close()
  console.log("PASS  Attachment Composer Demo 浏览器验收")
} finally {
  await browser?.close()
  await rm(routeDirectory, { recursive: true, force: true })
}

async function assertCount(locator, expected, message) {
  const deadline = Date.now() + 5_000
  let actual = await locator.count()
  while (actual !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    actual = await locator.count()
  }
  assert.equal(actual, expected, message)
}
