import { readFile } from "node:fs/promises"
import type { ModelMessage, TextStreamPart, ToolSet } from "ai"
import { prepareGeneration } from "@/lib/thread-chat/streaming/generation-plan"
import { runAgentTrace } from "@/lib/observability/trace"
import { TRACE_NAMES } from "@/constants/observability"
import type { AgentCase } from "@/evals/agent/schema"
import type { AgentExecutionOutput } from "@/evals/agent/result"
import { resolveFixturePath } from "@/evals/agent/cases"
import { assertEvaluationEnvironment } from "@/evals/agent/isolation"

function recentConversation(evaluationCase: AgentCase): string {
  return evaluationCase.input.messages
    .slice(-6)
    .map((message) => `${message.role}: ${message.text}`)
    .join("\n")
}

async function modelMessages(
  evaluationCase: AgentCase
): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = evaluationCase.input.messages.map(
    (message) => ({ role: message.role, content: message.text })
  )
  const attachments = evaluationCase.input.attachments
  if (attachments.length === 0) return messages

  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user"
  )
  if (lastUserIndex < 0)
    throw new Error("Multimodal case requires a user message")
  const original = evaluationCase.input.messages[lastUserIndex]
  messages[lastUserIndex] = {
    role: "user",
    content: [
      { type: "text", text: original.text },
      ...(await Promise.all(
        attachments.map(async (attachment) => ({
          type: "file" as const,
          data: await readFile(resolveFixturePath(attachment.fixture)),
          mediaType: attachment.mediaType,
          ...(attachment.filename ? { filename: attachment.filename } : {}),
        }))
      )),
    ],
  }
  return messages
}

export async function executeProductionContentCase(input: {
  evaluationCase: AgentCase
  modelId: string
  traceId: string
  candidate: string
}): Promise<AgentExecutionOutput> {
  assertEvaluationEnvironment()
  const latestUser = [...input.evaluationCase.input.messages]
    .reverse()
    .find((message) => message.role === "user")
  if (!latestUser) throw new Error("Evaluation case has no user message")

  return runAgentTrace(
    {
      name: TRACE_NAMES.threadChatGeneration,
      traceId: input.traceId,
      tags: ["evaluation", input.evaluationCase.suite],
      context: {
        environment: "evaluation",
        entrypoint: "agent-eval-content",
        caseId: input.evaluationCase.id,
        candidate: input.candidate,
        modelId: input.modelId,
      },
    },
    async () => {
      const prepared = await prepareGeneration({
        messageId: `eval-${input.evaluationCase.id}`,
        projectId: `eval-${input.evaluationCase.id}`,
        threadId: `eval-${input.evaluationCase.id}`,
        modelId: input.modelId,
        observabilityContext: {
          environment: "evaluation",
          entrypoint: "agent-eval-content",
          caseId: input.evaluationCase.id,
          candidate: input.candidate,
        },
        latestUserText: latestUser.text,
        recentConversation: recentConversation(input.evaluationCase),
        anchorText: null,
        modelMessages: await modelMessages(input.evaluationCase),
        abortSignal: AbortSignal.timeout(300_000),
      })
      const output: AgentExecutionOutput = {
        text: "",
        tools: [],
        terminalState: "completed",
        providerAttempts: [],
      }
      const reader = (
        prepared.textStream as ReadableStream<TextStreamPart<ToolSet>>
      ).getReader()
      while (true) {
        const { done, value: part } = await reader.read()
        if (done) break
        if (part.type === "text-delta") output.text += part.text
        if (part.type === "tool-call") output.tools!.push(part.toolName)
        if (part.type === "error") output.terminalState = "failed"
      }
      const routeChunk = prepared.leadingChunks?.find(
        (chunk) => chunk.type === "data-research-route"
      )
      if (routeChunk?.type === "data-research-route") {
        output.route = routeChunk.data.mode
      }
      const usage = prepared.usage
        ? await Promise.resolve(prepared.usage)
        : undefined
      if (usage) {
        output.usage = Object.fromEntries(
          Object.entries(usage).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number"
          )
        )
      }
      return output
    }
  )
}
