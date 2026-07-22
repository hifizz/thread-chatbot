/**
 * Markdown Artifact 共享契约纯函数测试：
 *   node --experimental-strip-types e2e/thread-chat/markdown-artifact.test.mjs
 */
import {
  MARKDOWN_ARTIFACT_CONTENT_MAX_CHARS,
  MARKDOWN_ARTIFACT_TOOL_NAME,
  isExplicitMarkdownDeliverableRequest,
  markdownArtifactProgressFromPartialInput,
  isMarkdownArtifactStreamEvent,
  markdownArtifactInputSchema,
  normalizeMarkdownArtifactInput,
} from "../../lib/chat/markdown-artifact.ts"

let failed = 0
const ok = (label, condition) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`)
  if (!condition) failed = 1
}

const normalized = normalizeMarkdownArtifactInput({
  title: "  发布说明  ",
  content: "```markdown\n# 发布说明\n\n```ts\nconst x = 1\n```\n```",
})
ok("标题 trim", normalized.title === "发布说明")
ok("拆除覆盖全文的 Markdown fence", normalized.content.startsWith("# 发布说明"))
ok(
  "保留正文内部代码 fence",
  normalized.content.includes("```ts\nconst x = 1\n```")
)

const plain = normalizeMarkdownArtifactInput({
  title: "Plain",
  content: "# Heading\n\n```js\nalert(1)\n```",
})
ok(
  "无外层 fence 时正文不变",
  plain.content === "# Heading\n\n```js\nalert(1)\n```"
)
ok(
  "归一化后空正文校验失败",
  !markdownArtifactInputSchema.safeParse({
    title: "空",
    content: "```markdown\n   \n```",
  }).success
)
ok(
  "超长正文校验失败",
  !markdownArtifactInputSchema.safeParse({
    title: "长文",
    content: "x".repeat(MARKDOWN_ARTIFACT_CONTENT_MAX_CHARS + 1),
  }).success
)

const positive = [
  "请帮我生成一个 Markdown，总结这次讨论",
  "把这些内容整理成 .md 文档",
  "用 Markdown 输出这份发布计划",
  "Create a Markdown document for the release notes",
  "Summarize this discussion into an .md file",
]
for (const text of positive)
  ok(`高置信交付正例：${text}`, isExplicitMarkdownDeliverableRequest(text))

const negative = [
  "Markdown 是什么？",
  "请解释 Markdown 语法",
  "How does Markdown work?",
  "Write an explanation of how to use Markdown syntax",
  "请用小标题总结这次讨论",
]
for (const text of negative)
  ok(`概念/普通回答反例：${text}`, !isExplicitMarkdownDeliverableRequest(text))

const event = {
  type: "tool-input-available",
  toolCallId: "call-1",
  toolName: MARKDOWN_ARTIFACT_TOOL_NAME,
  input: { title: "总结", content: "# 总结" },
}
ok("合法工具 complete event 通过守卫", isMarkdownArtifactStreamEvent(event))
ok(
  "未知工具被守卫拒绝",
  !isMarkdownArtifactStreamEvent({ ...event, toolName: "otherTool" })
)
ok(
  "空 content 被守卫拒绝",
  !isMarkdownArtifactStreamEvent({
    ...event,
    input: { title: "总结", content: "" },
  })
)

const progress = markdownArtifactProgressFromPartialInput("call-progress", {
  title: "  项目总结  ",
  content: "# 概览\n\n正文\n\n## 风险\n说明\n\n### 下一步",
})
ok("局部输入提取标题", progress.partialTitle === "项目总结")
ok("局部输入统计真实字符数", progress.characterCount === 27)
ok("局部输入统计真实行数", progress.lineCount === 8)
ok(
  "局部输入保留最近 Markdown 标题",
  progress.headings.join("|") === "概览|风险|下一步"
)

process.exit(failed)
