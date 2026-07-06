/**
 * 离线评测：对一组固定测试用例跑一遍对话模型，用「规则断言 + LLM-as-a-judge」两类
 * evaluator 打分，结果作为一次 experiment run 上报 Langfuse，可在 UI 里跨 run 对比
 * （换模型/改提示词前后各跑一次即可看到回归）。
 *
 * 用法：
 *   pnpm eval                                    # 用下方内置样例集
 *   LANGFUSE_EVAL_DATASET=<name> pnpm eval       # 用 Langfuse 上的同名 dataset
 *
 * 依赖 .env.local 里的 MINIMAX_* 与 LANGFUSE_* 配置。
 */
import { config } from "dotenv"

// minimax provider 在模块加载时就读环境变量，.env.local 必须先注入，业务模块一律动态导入
config({ path: ".env.local" })

const { generateText } = await import("ai")
const { minimaxChatModel, isMinimaxConfigured } =
  await import("../lib/ai/minimax")
const { registerObservability } = await import("../lib/observability/register")
const { flushLangfuseSpans, getLangfuseClient, isLangfuseConfigured } =
  await import("../lib/observability/langfuse")
const { TELEMETRY_FUNCTION_IDS } = await import("../constants/observability")

// 内置样例集：input 喂给模型，expectedOutput 是给 judge 参考的「评分要点」而非精确答案
const LOCAL_EVAL_ITEMS = [
  {
    input: "用一句话解释什么是 OpenTelemetry。",
    expectedOutput:
      "点出它是遥测数据（trace/metrics/log）采集的开源标准/框架即可",
  },
  {
    input: "PostgreSQL 里如何给 JSONB 字段建 GIN 索引？给出一条示例 SQL。",
    expectedOutput: "包含 CREATE INDEX ... USING GIN (jsonb 列) 形式的正确 SQL",
  },
  {
    input: "我最近工作压力很大，晚上总睡不好，有什么建议吗？",
    expectedOutput: "有共情、给出若干可操作的缓解建议、不做医疗诊断",
  },
]

/** 容错抽取模型输出里的 JSON 对象（judge 可能包一层 ```json 或加说明文字） */
function extractJson(raw: string): { score?: number; reason?: string } | null {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

async function main() {
  if (!isMinimaxConfigured()) {
    console.error("缺少 MINIMAX_API_KEY（.env.local），无法运行评测")
    process.exit(1)
  }
  if (!isLangfuseConfigured()) {
    console.error(
      "缺少 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY（.env.local），无法上报评测结果"
    )
    process.exit(1)
  }

  // 与服务端同一套注册逻辑：OTel provider + AI SDK 遥测集成，experiment 的每个 item 产生一条 trace
  registerObservability()
  const langfuse = getLangfuseClient()

  const datasetName = process.env.LANGFUSE_EVAL_DATASET
  const data = datasetName
    ? (await langfuse.dataset.get(datasetName)).items
    : LOCAL_EVAL_ITEMS
  console.log(
    datasetName
      ? `使用 Langfuse dataset「${datasetName}」，共 ${data.length} 条`
      : `使用内置样例集，共 ${data.length} 条（设 LANGFUSE_EVAL_DATASET 可改用远端 dataset）`
  )

  const result = await langfuse.experiment.run({
    name: "chat-quality",
    description: "对话质量基线：规则断言 + LLM-as-a-judge",
    metadata: { model: process.env.LLM_MODEL_ID ?? "MiniMax-M2" },
    data,
    task: async (item) => {
      const { text } = await generateText({
        model: minimaxChatModel(),
        prompt: String(item.input),
        telemetry: { functionId: TELEMETRY_FUNCTION_IDS.evalChat },
      })
      return text
    },
    evaluators: [
      // 规则断言：非空，且 reasoning 抽取干净（没把 <think> 泄漏进正文）
      async ({ output }) => ({
        name: "output-well-formed",
        value:
          typeof output === "string" &&
          output.trim().length > 0 &&
          !output.includes("<think>")
            ? 1
            : 0,
        dataType: "BOOLEAN" as const,
      }),
      // LLM-as-a-judge：以 expectedOutput 为评分要点给 0~1 分
      async ({ input, output, expectedOutput }) => {
        const { text } = await generateText({
          model: minimaxChatModel(),
          prompt: [
            "你是严格的评审员。根据「评分要点」评估「模型回答」对「用户问题」的质量。",
            '只输出一个 JSON 对象，不要任何其他文字：{"score": 0到1的小数, "reason": "一句话理由"}',
            "",
            `用户问题：${String(input)}`,
            `评分要点：${String(expectedOutput ?? "（无，凭常识判断有用性与正确性）")}`,
            `模型回答：${String(output)}`,
          ].join("\n"),
          // 评审自身的调用不进遥测，保持 experiment trace 只含被测任务
          telemetry: { isEnabled: false },
        })
        const parsed = extractJson(text)
        const score =
          typeof parsed?.score === "number"
            ? Math.min(1, Math.max(0, parsed.score))
            : 0
        return {
          name: "llm-judge-quality",
          value: score,
          comment:
            parsed?.reason ?? `judge 输出无法解析：${text.slice(0, 120)}`,
        }
      },
    ],
    maxConcurrency: 2,
  })

  console.log(await result.format())

  // 短生命周期进程：退出前把 score 队列与 span 批次全部发出去
  await langfuse.score.flush()
  await flushLangfuseSpans()
}

await main()
