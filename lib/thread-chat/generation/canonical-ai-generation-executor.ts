import { isStepCount, streamText, tool, type ToolSet } from "ai"

import { createToolStepPolicy } from "@/app/api/chat/tool-step-policy"
import { MAX_OUTPUT_TOKENS } from "@/constants/model"
import { RESEARCH_MAX_STEPS } from "@/constants/research"
import { resolveChatModel } from "@/lib/ai/provider"
import { isSearchConfigured } from "@/lib/ai/search"
import {
  isExplicitMarkdownArtifactRequest,
  MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
  MARKDOWN_ARTIFACT_TOOL_NAME,
  markdownArtifactInputSchema,
} from "@/lib/chat/markdown-artifact"
import {
  contextualUrlFollowUpRoute,
  deterministicResearchRoute,
  type ResearchRoute,
} from "@/lib/chat/research-router"
import { readUrlTool, webSearchTool } from "@/lib/chat/research-tools"
import { buildThreadChatSystem } from "@/lib/chat/thread-chat-prompt"
import { webResearchSourcesFromOutput } from "@/lib/chat/web-research-activity"

import type { ConversationSnapshotResult } from "../application/conversation-command-contracts"
import type { ConversationQueryPort } from "../application/conversation-command-service"
import type {
  CanonicalArtifactWriter,
  CanonicalGenerationExecutor,
  CanonicalGenerationRecord,
} from "../application/conversation-generation-service"
import {
  aggregateKnownUsage,
  emptyConversationGenerationCheckpoint,
  type ConversationGenerationCheckpoint,
} from "../domain/conversation-generation"
import { artifactId } from "../domain/conversation-model"

function messageText(
  parts: readonly { readonly type: string; readonly text?: string }[]
) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
}

/** 把规范快照编译成模型上下文，并排除较早 Turn 重新生成时的后续消息。 */
export function compileCanonicalGenerationMessages(input: {
  readonly loaded: ConversationSnapshotResult
  readonly generation: Pick<
    CanonicalGenerationRecord,
    "threadId" | "turnId" | "outputMessageId"
  >
}) {
  const ids =
    input.loaded.contextMessageIdsByThread[input.generation.threadId] ?? []
  const targetTurn = input.loaded.snapshot.turns[input.generation.turnId]
  if (!targetTurn) throw new Error("Generation 目标 Turn 不存在")
  return ids.flatMap((id) => {
    if (id === input.generation.outputMessageId) return []
    const message = input.loaded.snapshot.messages[id]
    if (!message || message.role === "context") return []
    const turn = input.loaded.snapshot.turns[message.turnId]
    if (
      message.threadId === input.generation.threadId &&
      turn &&
      turn.position > targetTurn.position
    )
      return []
    const content = messageText(message.content.parts)
    return content.trim() ? [{ role: message.role, content } as const] : []
  })
}

function canonicalResearchRoute(input: {
  latest: string
  recent: string
  searchReady: boolean
}): ResearchRoute {
  const candidate = contextualUrlFollowUpRoute(input.latest, input.recent) ??
    deterministicResearchRoute(input.latest) ?? {
      mode: "answer",
      reasonCode: "no_web_needed",
      urls: [],
      suggestedQueries: [],
    }
  return !input.searchReady && candidate.mode !== "answer"
    ? {
        mode: "answer",
        reasonCode: "search_unavailable",
        urls: [],
        suggestedQueries: [],
      }
    : candidate
}

function researchPlanFor(
  route: ResearchRoute,
  latest: string
): ConversationGenerationCheckpoint["researchPlan"] {
  if (route.mode !== "research") return null
  return {
    goal: latest.slice(0, 300),
    subquestions: [
      {
        id: "q1",
        question: latest.slice(0, 300),
        queries:
          route.suggestedQueries.length > 0
            ? route.suggestedQueries.slice(0, 4)
            : [latest.slice(0, 200)],
        preferredSourceTypes: ["official", "primary-source"],
        requiresPageFetch: true,
      },
    ],
    exitCriteria: {
      minimumIndependentSources: 3,
      requirePrimarySources: true,
      freshnessRequired: route.reasonCode === "freshness_required",
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function markdownArtifactTitle(content: string): string {
  const heading = content.match(/^#{1,6}[\t ]+(.+?)\s*#*\s*$/m)?.[1]?.trim()
  const firstLine = content
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/^#{1,6}[\t ]+/, "").trim())
    .find(Boolean)
  return (heading || firstLine || "Markdown 文档").slice(0, 80)
}

/** canonical 组合根使用的模型 executor；上下文、工具与产物均绑定规范实体。 */
export class CanonicalAiGenerationExecutor implements CanonicalGenerationExecutor {
  constructor(
    private readonly queries: ConversationQueryPort,
    private readonly artifacts?: CanonicalArtifactWriter
  ) {}

  async execute(input: Parameters<CanonicalGenerationExecutor["execute"]>[0]) {
    const loaded = await this.queries.getConversationSnapshot({
      actorUserId: input.generation.ownerId,
      conversationId: input.generation.conversationId,
    })
    if (!loaded) throw new Error("Conversation 在 Generation 执行前不可读取")
    const messages = compileCanonicalGenerationMessages({
      loaded,
      generation: input.generation,
    })
    const latest =
      [...messages].reverse().find((message) => message.role === "user")
        ?.content ?? ""
    const recent = messages
      .slice(-8)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n")
    const searchReady = isSearchConfigured()
    const researchRoute = canonicalResearchRoute({
      latest,
      recent,
      searchReady,
    })
    const markdownRequested = isExplicitMarkdownArtifactRequest(latest)
    if (markdownRequested && !this.artifacts)
      throw new Error("canonical Artifact writer 未配置")

    const incomingFork = Object.values(loaded.snapshot.threadForks).find(
      (fork) => fork.childThreadId === input.generation.threadId
    )
    const createMarkdownArtifact = tool({
      description: MARKDOWN_ARTIFACT_TOOL_DESCRIPTION,
      inputSchema: markdownArtifactInputSchema,
      execute: async () => ({ created: true as const }),
    })
    const tools: ToolSet = {
      ...(markdownRequested
        ? { [MARKDOWN_ARTIFACT_TOOL_NAME]: createMarkdownArtifact }
        : {}),
      ...(searchReady &&
      (researchRoute.mode === "search" || researchRoute.mode === "research")
        ? { webSearch: webSearchTool, readUrl: readUrlTool }
        : {}),
      ...(searchReady && researchRoute.mode === "fetch"
        ? { readUrl: readUrlTool }
        : {}),
    }
    let checkpoint: ConversationGenerationCheckpoint = {
      ...emptyConversationGenerationCheckpoint(),
      researchPlan: researchPlanFor(researchRoute, latest),
    }
    const publish = async (
      next: ConversationGenerationCheckpoint = checkpoint
    ) => {
      checkpoint = next
      await input.onCheckpoint(checkpoint)
    }
    if (checkpoint.researchPlan !== null) await publish()

    const result = streamText({
      model: resolveChatModel(input.generation.modelId),
      system: buildThreadChatSystem(incomingFork?.anchor?.quote.exact ?? null, {
        enableMarkdownArtifact: markdownRequested,
      }),
      messages,
      tools,
      prepareStep: createToolStepPolicy({
        isThreadChat: true,
        markdownArtifactRequested: markdownRequested,
        researchMode: researchRoute.mode,
      }),
      stopWhen: isStepCount(
        researchRoute.mode === "answer" ? 5 : RESEARCH_MAX_STEPS
      ),
      abortSignal: input.signal,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
    const calls = new Map<
      string,
      { readonly toolName: string; readonly input: unknown }
    >()
    const usageSteps: Array<{
      inputTokens?: number
      outputTokens?: number
      paid: boolean
    }> = []

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        await publish({
          ...checkpoint,
          body: checkpoint.body + part.text,
          contentState: "streaming",
        })
        continue
      }
      if (part.type === "finish-step") {
        usageSteps.push({
          inputTokens: part.usage.inputTokens,
          outputTokens: part.usage.outputTokens,
          paid: true,
        })
        continue
      }
      if (part.type === "tool-call") {
        calls.set(part.toolCallId, {
          toolName: part.toolName,
          input: part.input,
        })
        if (part.toolName === "webSearch" || part.toolName === "readUrl")
          await publish({
            ...checkpoint,
            contentState: "streaming",
            researchActivities: [
              ...checkpoint.researchActivities,
              {
                id: part.toolCallId,
                kind: part.toolName === "webSearch" ? "search" : "read",
                status: "running",
                sources: [],
              },
            ],
          })
        continue
      }
      if (part.type === "tool-result") {
        const call = calls.get(part.toolCallId)
        if (!call) continue
        if (call.toolName === MARKDOWN_ARTIFACT_TOOL_NAME) {
          const artifact = markdownArtifactInputSchema.parse(call.input)
          const id = artifactId(
            `${input.generation.id}:artifact:${part.toolCallId}`
          )
          await this.artifacts!.persistMarkdownArtifact({
            generation: input.generation,
            artifactId: id,
            title: artifact.title,
            content: artifact.content,
          })
          await publish({
            ...checkpoint,
            contentState: "streaming",
            artifactIds: [...new Set([...checkpoint.artifactIds, id])],
          })
          continue
        }
        if (call.toolName === "webSearch" || call.toolName === "readUrl") {
          const sources =
            call.toolName === "webSearch"
              ? webResearchSourcesFromOutput(part.output)
              : isRecord(part.output) && typeof part.output.url === "string"
                ? [{ url: part.output.url, title: part.output.url }]
                : []
          await publish({
            ...checkpoint,
            researchActivities: checkpoint.researchActivities.map((activity) =>
              activity.id === part.toolCallId
                ? { ...activity, status: "complete" as const, sources }
                : activity
            ),
          })
        }
        continue
      }
      if (part.type === "tool-error")
        await publish({
          ...checkpoint,
          researchActivities: checkpoint.researchActivities.map((activity) =>
            activity.id === part.toolCallId
              ? {
                  ...activity,
                  status: "error" as const,
                  error: "tool_execution_failed",
                }
              : activity
          ),
        })
    }
    // 部分 OpenAI-compatible 供应商会忽略强制 tool choice、直接返回 Markdown。
    // 明确的 Artifact 请求必须有确定性结果，因此把最终正文作为兼容性兜底持久化。
    if (
      markdownRequested &&
      checkpoint.artifactIds.length === 0 &&
      checkpoint.body.trim()
    ) {
      const id = artifactId(`${input.generation.id}:artifact:fallback`)
      await this.artifacts!.persistMarkdownArtifact({
        generation: input.generation,
        artifactId: id,
        title: markdownArtifactTitle(checkpoint.body),
        content: checkpoint.body,
      })
      await publish({
        ...checkpoint,
        contentState: "streaming",
        artifactIds: [id],
      })
    }
    const { knownUsage, completeness } = aggregateKnownUsage(usageSteps)
    checkpoint = {
      ...checkpoint,
      contentState: "complete",
      knownUsage,
    }
    return {
      outcome: "completed" as const,
      checkpoint,
      usageCompleteness: completeness,
      knownUsage,
    }
  }
}
