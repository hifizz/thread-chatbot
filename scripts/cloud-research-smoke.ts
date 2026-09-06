import { config } from "dotenv"
import { getChatModel } from "@/constants/model"
import { isModelConfigured, resolveChatModelWithRoute } from "@/lib/ai/llm/model-routes"
import { prepareCloudResearch } from "@/lib/cloud-research/generation"
import { parseCloudResearchRequest, requireCloudResearchConfig } from "@/lib/cloud-research/request"

config({ path: ".env.local", quiet: true })

/** 直接运行同一份生产任务逻辑；无需先启动数据库或浏览器。 */
async function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes("--check")
  const publish = args.includes("--publish")
  const text = args.filter((arg) => !arg.startsWith("--")).join(" ")
  if (!text) throw new Error('用法：pnpm cloud-research:smoke --check "@GitHub github/hifizz/thread-chatbot 调研 agent 云任务"；移除 --check 后真实执行，--publish 创建报告 PR。')
  const request = parseCloudResearchRequest(text)
  if (!request) throw new Error("请使用 @GitHub 和明确的仓库地址。")
  requireCloudResearchConfig(process.env.CLOUD_RESEARCH_DEMO_USER_ID ?? "", request.repository)
  const modelId = process.env.CLOUD_RESEARCH_MODEL_ID
  const registered = getChatModel(modelId)
  if (!registered || !isModelConfigured(registered)) throw new Error("请配置 CLOUD_RESEARCH_MODEL_ID（现有模型 ID）及对应 Provider 的 API Key。")
  console.log(`配置检查通过：${request.repository} · ${registered.id}；GitHub、E2B、模型凭据均已配置，尚未验证服务连接。`)
  if (checkOnly) return

  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once("SIGINT", stop)
  const generation = prepareCloudResearch({
    userId: process.env.CLOUD_RESEARCH_DEMO_USER_ID,
    messageId: crypto.randomUUID(),
    latestUserText: text,
    abortSignal: controller.signal,
  }, { ...request, publish: request.publish || publish }, resolveChatModelWithRoute(registered.id).model)
  let failed = false
  let report: { title: string; content: string } | undefined
  const reader = generation.textStream.getReader()
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const part = next.value
      if (part.type === "text-delta") process.stdout.write(part.text)
      if (part.type === "tool-call" && part.toolName === "createMarkdownArtifact") report = part.input as typeof report
      if (part.type === "tool-result") {
        const output = part.output as { status?: string; detail?: string; url?: string }
        if (output.detail) console.log(`\n[${output.status}] ${output.detail}`)
        if (output.url) console.log(`PR：${output.url}`)
      }
      if (part.type === "error" || (part.type === "finish" && part.finishReason === "error")) failed = true
    }
  } finally {
    reader.releaseLock()
    process.removeListener("SIGINT", stop)
  }
  if (report) console.log(`\n\n${report.title}\n\n${report.content}`)
  if (controller.signal.aborted) throw new Error("任务已停止。")
  if (failed) throw new Error("真实云调研未完成，请查看上述失败阶段；已生成的报告会保留在终端输出中。")
  console.log("\n真实云调研执行完成。")
}

main().catch((error: unknown) => {
  // 不打印 SDK 原始对象或凭据；生产执行错误由任务工具提供脱敏阶段信息。
  console.error(error instanceof Error ? error.message : "云调研启动失败。")
  process.exitCode = 1
})
