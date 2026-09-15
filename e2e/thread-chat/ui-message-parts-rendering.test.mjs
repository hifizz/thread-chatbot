import assert from "node:assert/strict"
import fs from "node:fs"
import { assistantPartRenderPlan } from "../../app/thread-chat/branching/assistant/assistant-part-render-plan.ts"

const message = {
  id: "assistant-parts",
  parentMessageId: "user-parts",
  role: "assistant",
  text: "正文",
  forks: [],
  status: "done",
  uiParts: [
    { type: "reasoning", text: "第一行\n第二行", state: "done" },
    { type: "text", text: "正文", state: "done" },
  ],
}

const plan = assistantPartRenderPlan(message)

assert.deepEqual(
  plan.map((item) => item.kind),
  ["reasoning", "text"],
  "assistant parts 必须按 AI SDK UIMessage.parts[] 顺序渲染"
)

const timelinePlan = assistantPartRenderPlan({
  ...message,
  uiParts: [
    { type: "reasoning", text: "规划检索", state: "done" },
    {
      type: "data-research-activity",
      id: "research-activity:search-1",
      data: {
        toolCallId: "search-1",
        kind: "search",
        status: "complete",
        query: "Cursor",
        sources: [{ title: "Cursor", url: "https://cursor.com" }],
      },
    },
    { type: "reasoning", text: "检查搜索结果", state: "done" },
    {
      type: "data-research-activity",
      id: "research-activity:read-1",
      data: {
        toolCallId: "read-1",
        kind: "read",
        status: "complete",
        url: "https://cursor.com",
        sources: [],
      },
    },
    { type: "reasoning", text: "整理结论", state: "done" },
    { type: "text", text: "正文", state: "done" },
  ],
})

assert.deepEqual(
  timelinePlan.map((item) => item.kind),
  ["reasoning", "research", "reasoning", "research", "reasoning", "text"],
  "思考和调研步骤必须按首次出现顺序交错渲染"
)
assert.deepEqual(
  timelinePlan
    .filter((item) => item.kind === "research")
    .map((item) => item.part.data.toolCallId),
  ["search-1", "read-1"],
  "每个调研步骤必须保留自己的时间线位置"
)

const assistantBodySource = fs.readFileSync(
  "app/thread-chat/branching/assistant/anchored-assistant-body.tsx",
  "utf8"
)
assert.match(assistantBodySource, /activities=\{\[part\.data\]\}/)
assert.doesNotMatch(
  assistantBodySource,
  /activities=\{message\.webResearch \?\? \[\]\}/
)

const css = fs.readFileSync("app/thread-chat/styles/columns.css", "utf8")
assert.match(
  css,
  /\.tc \.reasoning-body\s*\{[^}]*white-space:\s*pre-wrap;/s,
  "reasoning 展开内容必须保留换行"
)

const thinkingTraceSource = fs.readFileSync(
  "app/thread-chat/branching/assistant/thinking-trace.tsx",
  "utf8"
)
assert.match(thinkingTraceSource, /if \(!working && rows\.length === 1\)/)
assert.match(thinkingTraceSource, /className="thinking-trace-compact"/)
assert.match(thinkingTraceSource, /replace\(\/\\\*\\\*\(\[\^\*\]\+\)\\\*\\\*\/g, "\$1"\)/)

const thinkingTraceCss = fs.readFileSync(
  "app/thread-chat/styles/thinking-trace.css",
  "utf8"
)
assert.match(
  thinkingTraceCss,
  /\.tc \.thinking-trace\s*\{[^}]*margin:\s*10px 0;/s,
  "thinking 轨迹在正文流中必须有纵向间距"
)
assert.match(
  thinkingTraceCss,
  /\.tc \.thinking-trace-compact\s*\{[^}]*color:\s*var\(--tc-content-muted\);[^}]*white-space:\s*pre-wrap;/s,
  "单段完成态必须使用浅色轻量文字并保留换行"
)
const threadChatCss = fs.readFileSync("app/thread-chat/thread-chat.css", "utf8")
assert.match(
  threadChatCss,
  /@import "\.\/styles\/messages-stream\.css";\s*@import "\.\/styles\/thinking-trace\.css";/,
  "thinking-trace.css 必须按序接入桶文件"
)

const supplementalPartsSource = fs.readFileSync(
  "app/thread-chat/chat/message/ui-message-parts.tsx",
  "utf8"
)
const imageBranchStart = supplementalPartsSource.indexOf(
  'part.mediaType.startsWith("image/")'
)
const imageBranchEnd = supplementalPartsSource.indexOf(
  ") : (",
  imageBranchStart
)
assert.ok(imageBranchStart >= 0 && imageBranchEnd > imageBranchStart)
const imageBranch = supplementalPartsSource.slice(
  imageBranchStart,
  imageBranchEnd
)
assert.match(imageBranch, /<Dialog/)
assert.match(imageBranch, /<DialogTrigger/)
assert.match(imageBranch, /max-w-\[min\(18rem,72vw\)\]/)
assert.equal((imageBranch.match(/src=\{part\.url\}/g) ?? []).length, 2)
assert.doesNotMatch(imageBranch, /target="_blank"/)
assert.doesNotMatch(imageBranch, /href=\{part\.url\}/)
assert.match(supplementalPartsSource, /data-ui-message-files="true"/)
assert.match(supplementalPartsSource, /ms-auto flex w-fit max-w-full/)
assert.match(supplementalPartsSource, /function TextAttachmentPreview/)
assert.match(supplementalPartsSource, /<Attachment[\s>]/)
assert.match(supplementalPartsSource, /<AttachmentTitle/)
assert.match(supplementalPartsSource, /<AttachmentDescription/)
assert.match(
  supplementalPartsSource,
  /<DialogDescription className="mt-1 text-xs">/
)
assert.match(supplementalPartsSource, /fetch\(`\$\{part\.url\}\/content`/)
assert.match(supplementalPartsSource, /aria-label=\{`预览 /)
assert.match(supplementalPartsSource, /import \{ Skeleton \}/)
assert.ok((supplementalPartsSource.match(/<Skeleton /g) ?? []).length >= 5)
assert.match(supplementalPartsSource, /className="sr-only">文件加载中/)
assert.doesNotMatch(supplementalPartsSource, /正在打开文件/)
assert.doesNotMatch(supplementalPartsSource, /LoaderCircle/)
assert.match(supplementalPartsSource, />\s*重试\s*</)
assert.match(supplementalPartsSource, />\s*下载文件\s*</)
assert.doesNotMatch(supplementalPartsSource, /纯文本预览/)
assert.doesNotMatch(supplementalPartsSource, /不会执行文件中的 HTML/)
assert.match(supplementalPartsSource, /nativeButton=\{false\}/)
assert.match(supplementalPartsSource, /\?download=1/)

const contentRouteSource = fs.readFileSync(
  "app/api/attachments/[id]/content/route.ts",
  "utf8"
)
assert.match(contentRouteSource, /getCurrentUserId\(\)/)
assert.match(contentRouteSource, /eq\(attachments\.userId, userId\)/)
assert.match(contentRouteSource, /row\.status !== "ready"/)
assert.match(contentRouteSource, /row\.mimeType !== "text\/plain"/)
assert.match(contentRouteSource, /getObjectBytes\(row\.key\)/)
assert.match(contentRouteSource, /text\/plain; charset=utf-8/)
assert.match(contentRouteSource, /private, no-store/)
assert.doesNotMatch(contentRouteSource, /error: "未配置 R2/)
assert.doesNotMatch(contentRouteSource, /error: ".*UTF-8/)

const downloadRouteSource = fs.readFileSync(
  "app/api/attachments/[id]/route.ts",
  "utf8"
)
const r2Source = fs.readFileSync("lib/storage/r2.ts", "utf8")
assert.match(downloadRouteSource, /searchParams\.get\("download"\) === "1"/)
assert.match(r2Source, /ResponseContentDisposition/)

console.log(
  "PASS  UIMessage parts renderer previews text attachments without exposing R2"
)
