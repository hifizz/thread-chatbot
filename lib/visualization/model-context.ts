import { visualizationDataSchema } from "@/lib/visualization/schema"
import { verifyFlowGraph } from "@/lib/visualization/verify-flow"

/** 历史图以语义数据进入模型上下文，支持继续修改和分支讨论。 */
export function visualizationForModel(data: unknown) {
  const parsed = visualizationDataSchema.safeParse(data)
  if (!parsed.success || !verifyFlowGraph(parsed.data.spec).valid) return undefined
  return {
    type: "text" as const,
    text: `User flow visualization (FlowSpec):\n${JSON.stringify(parsed.data)}`,
  }
}
