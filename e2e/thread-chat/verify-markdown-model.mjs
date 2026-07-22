/**
 * 默认 MiniMax 的真实 Markdown 工具选择语料验收。会产生少量真实模型用量。
 * 运行：node --experimental-strip-types e2e/thread-chat/verify-markdown-model.mjs
 */
import dotenv from "dotenv"

dotenv.config({ path: ".env.local", quiet: true })

const [{ createOpenAICompatible }, { generateText, isStepCount, tool }] =
  await Promise.all([import("@ai-sdk/openai-compatible"), import("ai")])
const {
  MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  MARKDOWN_ARTIFACT_TOOL_NAME,
  markdownArtifactInputSchema,
} = await import("../../lib/chat/markdown-artifact.ts")
const { THREAD_CHAT_SYSTEM } = await import("../../constants/thread-chat.ts")

if (!process.env.MINIMAX_API_KEY) {
  console.log("SKIP  MINIMAX_API_KEY 未配置")
  process.exit(0)
}

const provider = createOpenAICompatible({
  name: "minimax-markdown-e2e",
  baseURL: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1",
  apiKey: process.env.MINIMAX_API_KEY,
  includeUsage: true,
})
const model = provider(process.env.LLM_MODEL_ID ?? "MiniMax-M2")
const createMarkdownArtifact = tool({
  description: MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  inputSchema: markdownArtifactInputSchema,
  execute: async () => ({ created: true }),
})

const cases = [
  {
    label: "中文显式交付",
    prompt: "请把登录、导出和监控这三点整理成一份简短的 Markdown 文档。",
    expected: true,
  },
  {
    label: "英文显式交付",
    prompt:
      "Deliver a short .md release note for version 1.2: fixed login and added export.",
    expected: true,
  },
  {
    label: "等价改写表达",
    prompt:
      "我要把这段会议纪要直接存成 README.md：周五上线，负责人是 Alex，发布前跑回归测试。",
    expected: true,
  },
  {
    label: "概念问答反例",
    prompt: "Markdown 是什么？请用两句话解释。",
    expected: false,
  },
]

let failed = false
for (const item of cases) {
  const result = await generateText({
    model,
    system: THREAD_CHAT_SYSTEM,
    prompt: item.prompt,
    tools: { [MARKDOWN_ARTIFACT_TOOL_NAME]: createMarkdownArtifact },
    stopWhen: isStepCount(2),
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0
        ? { activeTools: [MARKDOWN_ARTIFACT_TOOL_NAME] }
        : { activeTools: [] },
    maxOutputTokens: 512,
  })
  const calls = result.steps.flatMap((step) => step.toolCalls)
  const selected = calls.some(
    (call) => call.toolName === MARKDOWN_ARTIFACT_TOOL_NAME
  )
  const once = calls.length <= 1
  const pass = selected === item.expected && once
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${item.label}：${selected ? "调用 Markdown 工具" : "普通回答"}${once ? "" : `，调用 ${calls.length} 次`}`
  )
  failed ||= !pass
}

if (failed) process.exitCode = 1
