/**
 * 复现：长多步生成中第 N 个 createMarkdownArtifact 工具调用在 input-streaming 阶段流断。
 * 用真实 token-router 上游，记录每个 chunk 类型和错误。
 * 用法：source .env.local && pnpm tsx scripts/repro-stream-die.ts
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { streamText, tool, jsonSchema, stepCountIs } from "ai"
import { resolveChatModelWithRoute } from "../lib/ai/llm/providers.ts"

const createMarkdownArtifact = tool({
  description: "创建并交付一份 Markdown 文档",
  inputSchema: jsonSchema<{ title: string; content: string }>({
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
    },
    required: ["title", "content"],
  }),
  execute: async ({ title }) => ({ created: true, title }),
})

async function main() {
  const { model, route } = resolveChatModelWithRoute("private-relay-gpt-6-astra")
  console.log(`model: ${route.upstreamModel} via ${route.protocol}`)

  const result = streamText({
    model,
    tools: { createMarkdownArtifact },
    stopWhen: stepCountIs(10),
    maxOutputTokens: 32_000,
    system:
      "你是文档助手。用户要求生成多份文档时，必须依次调用 createMarkdownArtifact 工具分别创建，不要合并。",
    prompt:
      "请为一个假想的 OpenSpec change（isolate-project-document-edit-drafts）依次生成三份文档：" +
      "proposal.md、design.md、tasks.md。每份都要详细、成体系（每份至少 2000 字中文），" +
      "分别通过三次 createMarkdownArtifact 工具调用创建。",
    onError: (e) => console.log(">>> onError:", e),
  })

  const started = Date.now()
  try {
    for await (const chunk of result.fullStream) {
      const t = chunk.type
      if (t === "error") {
        console.log(`>>> stream error chunk at ${Date.now() - started}ms:`, chunk.error)
        continue
      }
      if (t === "tool-input-start" || t === "tool-input-end" || t === "tool-call" || t === "tool-result" || t === "finish" || t === "start-step" || t === "finish-step") {
        const extra =
          t === "tool-call" || t === "tool-result"
            ? ` ${(chunk as { toolName?: string }).toolName} ${(chunk as { toolCallId?: string }).toolCallId}`
            : t === "tool-input-start" || t === "tool-input-end"
              ? ` ${(chunk as { toolName?: string }).toolName} ${(chunk as { id?: string }).id}`
              : t === "finish"
                ? ` reason=${(chunk as { finishReason?: string }).finishReason}`
                : ""
        console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${t}${extra}`)
      }
    }
  } catch (e) {
    console.log(`>>> fullStream threw at ${Date.now() - started}ms:`, e)
  }
  console.log("done in", ((Date.now() - started) / 1000).toFixed(1), "s")
}

main()
