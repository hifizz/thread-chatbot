import { createHash } from "node:crypto"
import { asSchema, jsonSchema, type ToolSet } from "ai"
import { z } from "zod"
import { DOCUMENT_INSTRUCTIONS } from "@/constants/project-documents"
import { DOCUMENT_TOOL_EVALUATION } from "@/constants/document-tool-evaluation"
import { buildDocumentTools } from "@/lib/thread-chat/streaming/documents/tools"
import { createResearchTools } from "@/lib/chat/research-tools"
import { canonicalEvaluationJson } from "../fingerprint"
import baseline from "./baseline.json"

export type DocumentPolicy = "baseline" | "current"

/** 只读取真实工具的定义；执行器会替换全部 execute，绝不调用生产数据库或网页。 */
export async function documentToolPolicy(variant: DocumentPolicy) {
  const current: ToolSet = {
    ...buildDocumentTools({ userId: "evaluation", projectId: "evaluation", threadId: "evaluation", messageId: "evaluation" }),
    ...createResearchTools(),
  }
  if (!current.updateProjectDocument) throw new Error("专项评测要求暴露更新工具，请勿设置 THREAD_CHAT_DOCUMENT_WRITES=false；执行仍由模拟后端接管")
  const tools: ToolSet = {}
  for (const name of Object.keys(baseline.tools) as Array<keyof typeof baseline.tools>) {
    const definition = current[name]
    const legacyValidator = z.fromJSONSchema(baseline.tools[name].inputSchema as Parameters<typeof z.fromJSONSchema>[0])
    tools[name] = {
      description: variant === "current" ? definition.description : baseline.tools[name].description,
      inputSchema: variant === "current" ? definition.inputSchema
        : jsonSchema(baseline.tools[name].inputSchema as Parameters<typeof jsonSchema>[0], { validate: (input) => {
          const result = legacyValidator.safeParse(input)
          return result.success ? { success: true, value: result.data } : { success: false, error: result.error }
        } }),
    }
  }
  const instructions = variant === "current" ? DOCUMENT_INSTRUCTIONS : baseline.instructions
  const serialized = await Promise.all(Object.entries(tools).map(async ([name, definition]) => ({
    name, description: definition.description, inputSchema: await asSchema(definition.inputSchema).jsonSchema,
  })))
  const fingerprint = createHash("sha256").update(canonicalEvaluationJson({ instructions, tools: serialized,
    responsePolicy: variant, contextPolicy: DOCUMENT_TOOL_EVALUATION.contextPolicy })).digest("hex")
  return { variant, instructions, tools, fingerprint, sourceCommit: variant === "baseline" ? baseline.sourceCommit : "working-tree" }
}

export type DocumentToolPolicy = Awaited<ReturnType<typeof documentToolPolicy>>
