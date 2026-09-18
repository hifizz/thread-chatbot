import { generateText, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai"
import { DOCUMENT_TOOL_EVALUATION } from "@/constants/document-tool-evaluation"
import { DOCUMENT_UNAVAILABLE_FAILURE } from "@/constants/project-documents"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import { TRACE_NAMES } from "@/constants/observability"
import { buildAiTelemetryConfig } from "@/lib/observability/ai-sdk"
import { runAgentTrace } from "@/lib/observability/trace"
import { resolveChatModel } from "@/lib/ai/llm/providers"
import { notFound } from "@/lib/thread-chat/application/errors"
import { createDocumentToolExecutor } from "@/lib/thread-chat/streaming/documents/execution"
import type { AgentCase } from "../schema"
import type { AgentCaseExecutor } from "../runner"
import type { EvaluationToolCall } from "../result"
import type { DocumentToolPolicy } from "./policy"

export function documentToolMessages(evaluationCase: AgentCase, policy: DocumentToolPolicy): ModelMessage[] {
  const fixture = evaluationCase.input.documentTools!
  const messages: ModelMessage[] = []
  if (fixture.history !== "none") {
    const web = fixture.history === "web-snapshot"
    const toolName = web ? "readUrl" : "readProjectDocument"
    messages.push({ role: "user", content: web ? `打开 ${fixture.page.url}` : "读取方案1.md" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "historical-read", toolName,
        input: web ? { url: fixture.page.url } : { documentId: fixture.documents[0].artifactId } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "historical-read", toolName,
        output: web ? { type: "json", value: { ok: true, data: { url: fixture.page.url, docId: fixture.page.snapshotId, content: "旧快照，仅有介绍，未包含验收阈值。" } } }
          : policy.variant === "baseline" ? { type: "error-text", value: "资源不存在" }
            : { type: "json", value: DOCUMENT_UNAVAILABLE_FAILURE } }] },
      { role: "assistant", content: web ? "已获取介绍。" : "未读到内容。" })
  }
  messages.push(...evaluationCase.input.messages.map((message) => ({ role: message.role, content: message.text })))
  return messages
}

export function createDocumentCaseExecutor(policy: DocumentToolPolicy, modelOverride?: LanguageModel): AgentCaseExecutor {
  return async ({ evaluationCase, candidate, signal, traceId }) => {
    if (evaluationCase.execution !== "tool-simulation" || evaluationCase.sensitivity !== "synthetic" || !evaluationCase.input.documentTools)
      throw new Error("文档工具模拟执行器只接受合成专项题集")
    const fixture = evaluationCase.input.documentTools
    const recover = createDocumentToolExecutor()
    const executed = new Map<string, EvaluationToolCall>()
    const tools: ToolSet = Object.fromEntries(Object.entries(policy.tools).map(([toolName, definition]) => [toolName, {
      ...definition,
      execute: async (raw: unknown, options: { toolCallId: string }) => {
        const input = raw as Record<string, string | undefined>
        const call: EvaluationToolCall = { toolName, toolCallId: options.toolCallId, input: raw }
        executed.set(options.toolCallId, call)
        const operation = async (): Promise<unknown> => {
          signal.throwIfAborted()
          if (toolName === "findProjectDocuments") return fixture.documents.filter((doc) =>
            (!input.query || doc.title.toLocaleLowerCase().includes(input.query.trim().toLocaleLowerCase())) &&
            (!input.artifactId || doc.artifactId === input.artifactId))
            .map((doc) => ({ id: doc.id, projectId: "synthetic-project", title: doc.title, currentRevisionId: doc.revisionId }))
          if (toolName === "readProjectDocument") {
            const doc = fixture.documents.find((item) => item.id === input.documentId && (!input.revisionId || item.revisionId === input.revisionId))
            if (!doc) notFound()
            return { document: { id: doc.id, projectId: "synthetic-project", title: doc.title, currentRevisionId: doc.revisionId },
              revision: { id: doc.revisionId, documentId: doc.id, artifactId: doc.artifactId, title: doc.title, content: doc.content, revisionNumber: 1 },
              readId: crypto.randomUUID(), isCurrent: true }
          }
          if (toolName === "readUrl") {
            if (input.url !== fixture.page.url || input.cursor) return { ok: false, error: { code: "INVALID_SOURCE", message: "请使用原 URL，不带旧游标。" }, nextAction: "read_url" }
            return { ok: true, data: { url: fixture.page.url, content: fixture.page.content,
              ...(policy.variant === "baseline" ? { docId: fixture.page.snapshotId } : {}),
              fullyRead: true, hasMore: false, nextCursor: null } }
          }
          if (toolName === "webSearch") return { ok: true, data: { results: [{ url: fixture.page.url, title: "置信度文档", snippet: "请打开页面核对当前阈值。" }] } }
          // 保留写工具以检测越权意图；模拟后端始终不写入任何数据。
          return { status: "rejected", code: "WRITES_DISABLED" }
        }
        try {
          call.output = policy.variant === "current" && toolName === "readProjectDocument"
            ? await recover(toolName, { documentId: input.documentId!, revisionId: input.revisionId }, options.toolCallId, signal, operation)
            : await operation()
          return call.output
        } catch (error) {
          call.error = error instanceof Error ? error.message : "ToolError"
          throw error
        }
      },
    }]))
    const knownDocuments = fixture.knownDocumentIds ? `\n系统项目文档目录：${JSON.stringify(fixture.documents.map((doc) => ({ documentId: doc.id, title: doc.title })))}` : ""
    return runAgentTrace({ name: TRACE_NAMES.documentToolEvaluation, traceId,
      context: { environment: "evaluation", modelId: candidate.model }, tags: ["document-tools", "tool-simulation", policy.variant] }, async () => {
      const result = await generateText({
        model: modelOverride ?? resolveChatModel(candidate.model), instructions: policy.instructions + knownDocuments,
        messages: documentToolMessages(evaluationCase, policy), tools,
        stopWhen: stepCountIs(DOCUMENT_TOOL_EVALUATION.maxSteps),
        maxOutputTokens: DOCUMENT_TOOL_EVALUATION.maxOutputTokens, maxRetries: 0, abortSignal: signal,
        ...buildAiTelemetryConfig(MODEL_CALL_PURPOSE.chatAnswer, { environment: "evaluation", modelId: candidate.model }),
      })
      // SDK 拒绝的无效参数也必须记分，不能只统计成功进入 execute 的调用。
      const calls = result.steps.flatMap((step) => step.toolCalls.map((call): EvaluationToolCall => executed.get(call.toolCallId) ?? {
        toolCallId: call.toolCallId, toolName: call.toolName, input: call.input, error: "INVALID_TOOL_CALL",
      }))
      return { traceId, text: result.text, tools: calls.map((call) => call.toolName), toolCalls: calls,
        finishReason: result.finishReason, terminalState: result.finishReason === "stop" ? "completed" : "failed",
        usage: { inputTokens: result.totalUsage.inputTokens ?? 0, outputTokens: result.totalUsage.outputTokens ?? 0 } }
    })
  }
}
