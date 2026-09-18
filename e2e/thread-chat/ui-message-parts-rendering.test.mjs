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

const mergedPlan = assistantPartRenderPlan({
  ...message,
  uiParts: [
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
    {
      type: "data-research-activity",
      id: "research-activity:read-1",
      data: {
        toolCallId: "read-1",
        kind: "read",
        status: "complete",
        url: "https://cursor.com",
        title: "Cursor",
        sources: [],
      },
    },
    {
      type: "data-research-activity",
      id: "research-activity:read-2",
      data: {
        toolCallId: "read-2",
        kind: "read",
        status: "complete",
        url: "https://cursor.com/pricing",
        sources: [],
      },
    },
    { type: "text", text: "正文", state: "done" },
  ],
})
assert.equal(
  mergedPlan.filter((item) => item.kind === "research").length,
  1,
  "连续的联网活动必须合并为一个轨迹块"
)
assert.equal(
  mergedPlan[0].activities.length,
  3,
  "合并后的轨迹块必须保留全部活动"
)
assert.equal(
  mergedPlan[0].part.data.toolCallId,
  "search-1",
  "合并块的位置与 key 锚定在首个活动"
)

const artifactPlan = assistantPartRenderPlan({
  ...message,
  uiParts: [
    { type: "text", text: "说明", state: "done" },
    {
      type: "tool-createMarkdownArtifact",
      toolCallId: "md-1",
      state: "output-available",
      input: { title: "报告", content: "# 报告" },
      output: { created: true, artifactId: "artifact-1" },
    },
  ],
})
assert.deepEqual(
  artifactPlan.map((item) => item.kind),
  ["text", "artifact"],
  "createMarkdownArtifact 工具 part 必须在正文流中原位渲染为 artifact"
)

const documentPlan = assistantPartRenderPlan({
  ...message,
  uiParts: [
    { type: "text", text: "先查文档", state: "done" },
    {
      type: "tool-readProjectDocument",
      toolCallId: "read-1",
      state: "output-available",
      input: { documentId: "doc-1" },
      output: {},
    },
    {
      type: "tool-updateProjectDocument",
      toolCallId: "update-1",
      state: "output-error",
      input: { documentId: "doc-1" },
      errorText: "资源不存在",
    },
    { type: "reasoning", text: "审视结果", state: "done" },
    {
      type: "tool-updateProjectDocument",
      toolCallId: "update-2",
      state: "output-available",
      input: { documentId: "doc-1" },
      output: { status: "committed" },
    },
  ],
})
assert.deepEqual(
  documentPlan.map((item) => item.kind),
  ["text", "document", "reasoning", "document"],
  "文档工具 part 必须走专属渲染分支，不得落入 createMarkdownArtifact 的“生成文档”轨迹"
)
assert.equal(
  documentPlan[1].documents.length,
  2,
  "连续的文档工具调用必须合并为一个时序轨迹块"
)
assert.equal(
  documentPlan[3].documents.length,
  1,
  "被思考分隔的文档调用必须拆分为独立轨迹块"
)

const assistantBodySource = fs.readFileSync(
  "app/thread-chat/branching/assistant/anchored-assistant-body.tsx",
  "utf8"
)
assert.match(assistantBodySource, /activities=\{activities \?\? \[part\.data\]\}/)
assert.doesNotMatch(
  assistantBodySource,
  /activities=\{message\.webResearch \?\? \[\]\}/
)
assert.match(
  assistantBodySource,
  /MarkdownArtifactToolPart/,
  "artifact part 必须原位分发到 MarkdownArtifactToolPart"
)
assert.match(
  assistantBodySource,
  /artifact=\{\s*artifactId \? state\.artifacts\[artifactId\] : undefined\s*\}/,
  "artifact 卡片必须从 store 按 output.artifactId 取实体"
)
assert.match(
  assistantBodySource,
  /<DocumentTrace parts=\{documentParts\} settled=\{settled\} \/>/,
  "文档工具 part 必须分发到 DocumentTrace 时序轨迹"
)
assert.match(
  assistantBodySource,
  /<DocumentUpdateTool/,
  "updateProjectDocument 的提交结果必须保留 DocumentUpdateTool 结果卡片"
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
assert.match(
  thinkingTraceSource,
  /allowedElements=\{INLINE_MARKDOWN_ELEMENTS\}[\s\S]*unwrapDisallowed/,
  "reasoning 文本必须按行内 markdown 渲染（**强调** 不得原样露出）"
)
assert.match(
  thinkingTraceSource,
  /renderPrimary=\{\(row\) => <InlineMarkdown text=\{row\.primary\} \/>\}/,
  "reasoning 轨迹行必须走行内 markdown 渲染"
)
assert.match(
  thinkingTraceSource,
  /<InlineMarkdown text=\{rows\[0\]\.primary\} \/>/,
  "单段完成态轻量行同样渲染行内 markdown"
)
assert.doesNotMatch(
  thinkingTraceSource,
  /replace\(\/\\\*/,
  "不再用正则剥除强调记号冒充渲染"
)
assert.match(
  thinkingTraceSource,
  /currentActivities\.every\(\s*\(activity\) => activity\.kind === "read"/s,
  "SearchTrace 必须按当前 activity kind 区分 search 与 read"
)
assert.match(
  thinkingTraceSource,
  /正在读取 \$\{hostOf\(runningActivity\.url\)\}/,
  "进行中的读取必须在标题中暴露目标站点"
)
assert.match(
  thinkingTraceSource,
  /已搜索网络 · \$\{sourceCount\} 个来源/,
  "合并轨迹的完成摘要必须给出来源数"
)
assert.match(
  thinkingTraceSource,
  /已读取 \$\{readCount\} 个网页/,
  "合并轨迹的完成摘要必须给出读取数"
)
assert.match(
  thinkingTraceSource,
  /读取失败/,
  "失败的读取必须在轨迹中显式标记"
)
assert.doesNotMatch(
  thinkingTraceSource,
  /route\?\.mode === "fetch"/,
  "readUrl 标题不得由整条消息 route 决定"
)
assert.match(
  thinkingTraceSource,
  /icon: "book-open"/,
  "readUrl 轨迹行必须声明 BookOpen 图标"
)

const thinkingStateSource = fs.readFileSync(
  "components/primitives/ThinkingState.tsx",
  "utf8"
)
assert.match(
  thinkingStateSource,
  /import \{ BookOpen, FilePenLine \} from "lucide-react"/
)
assert.match(thinkingStateSource, /row\.icon === "book-open"/)
assert.match(thinkingStateSource, /<BookOpen aria-hidden/)

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
