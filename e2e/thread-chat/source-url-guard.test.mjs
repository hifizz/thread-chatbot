import assert from "node:assert/strict"
import test from "node:test"

import {
  buildSourceFooter,
  createSourceUrlGuardTransform,
  sanitizeSourceUrls,
} from "../../lib/chat/source-url-guard.ts"

const allowed = new Set([
  "https://nextjs.org/docs/app",
  "https://ai-sdk.dev/docs/tools",
])

test("只保留工具实际返回的 URL", () => {
  const input =
    "官方文档 [Next](https://nextjs.org/docs/app)，不要使用 https://example.com/fake。"
  assert.equal(
    sanitizeSourceUrls(input, allowed).text,
    "官方文档 [Next](https://nextjs.org/docs/app)，不要使用 [未核验链接已移除]。"
  )
})

test("跨 chunk URL 在结束前保持 pending，完成后再校验", () => {
  const first = sanitizeSourceUrls("参考 https://ai-sdk", allowed, false)
  assert.equal(first.text, "参考 ")
  assert.equal(first.pending, "https://ai-sdk")

  const second = sanitizeSourceUrls(
    `${first.pending}.dev/docs/tools）后续`,
    allowed,
    false
  )
  assert.equal(second.text, "https://ai-sdk.dev/docs/tools）后续")
  assert.equal(second.pending, "")
})

test("跨 chunk 伪造 URL 被移除", () => {
  const first = sanitizeSourceUrls("h", allowed, false)
  assert.equal(first.pending, "h")
  const second = sanitizeSourceUrls(`${first.pending}ttps://evil.test/x `, allowed)
  assert.equal(second.text, "[未核验链接已移除] ")
})

test("可信来源以 Markdown tag 追加到回答末尾", () => {
  const footer = buildSourceFooter(
    new Map([
      ["https://nextjs.org/docs/app", "Next.js [App] Docs"],
      ["https://ai-sdk.dev/docs/tools", "AI SDK Tools"],
    ])
  )
  assert.equal(
    footer,
    "\n\n信息源：[Next.js App Docs](https://nextjs.org/docs/app) · [AI SDK Tools](https://ai-sdk.dev/docs/tools)"
  )
})

test("正文已有可信引用时不再追加重复信息源 footer", async () => {
  const state = {
    active: true,
    allowedUrls: new Set(["https://nextjs.org/docs/app"]),
    sources: new Map([["https://nextjs.org/docs/app", "Next.js App Docs"]]),
  }
  const transform = createSourceUrlGuardTransform(state)({
    tools: {},
    stopStream() {},
  })
  const chunks = [
    {
      type: "text-delta",
      id: "text-1",
      text: "参考来源：[Next.js](https://nextjs.org/docs/app)",
    },
    { type: "text-end", id: "text-1" },
    {
      type: "finish",
      finishReason: "stop",
      rawFinishReason: "stop",
      totalUsage: {},
    },
  ]
  const output = []
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  }).pipeThrough(transform)
  for await (const chunk of stream) output.push(chunk)

  assert.equal(
    output.some(
      (chunk) =>
        chunk.type === "text-delta" && chunk.text.includes("信息源：")
    ),
    false
  )
})

test("来源 footer 在 finish 之前进入流", async () => {
  const state = {
    active: true,
    allowedUrls: new Set(["https://nextjs.org/docs/app"]),
    sources: new Map([["https://nextjs.org/docs/app", "Next.js Docs"]]),
  }
  const transform = createSourceUrlGuardTransform(state)({
    tools: {},
    stopStream() {},
  })
  const chunks = [
    { type: "text-delta", id: "text-1", text: "回答" },
    { type: "text-end", id: "text-1" },
    {
      type: "finish",
      finishReason: "stop",
      rawFinishReason: "stop",
      totalUsage: {},
    },
  ]
  const output = []
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  }).pipeThrough(transform)
  for await (const chunk of stream) output.push(chunk)

  const finishIndex = output.findIndex((chunk) => chunk.type === "finish")
  const footerIndex = output.findIndex(
    (chunk) => chunk.type === "text-delta" && chunk.text.includes("信息源")
  )
  assert.ok(footerIndex >= 0)
  assert.ok(footerIndex < finishIndex)
})
