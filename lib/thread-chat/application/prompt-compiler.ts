import {
  convertToModelMessages,
  type ModelMessage,
  type ToolSet,
} from "ai"
import { db } from "@/lib/db"
import {
  INHERITED_CHAR_BUDGET,
  THREAD_AGENT_KERNEL_VERSION,
  THREAD_CHAT_AGENT_KERNEL,
  THREAD_PROMPT_CHARACTERS_PER_TOKEN_ESTIMATE,
  THREAD_PROMPT_COMPILER_VERSION,
} from "@/constants/thread-chat"
import { resolveAttachmentParts } from "@/lib/chat/resolve-attachments"
import type { PromptProviderOptions } from "@/lib/ai/prompt-cache"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import {
  applyInheritedBudget,
  omittedNoticeText,
} from "@/lib/thread-chat/application/prompt-policy"
import { stripTransientParts } from "@/lib/thread-chat/application/command-utils"
import { notFound, stateConflict } from "@/lib/thread-chat/application/errors"
import { buildBranchOriginQuote } from "@/lib/thread-chat/application/quote-resolver"
import { threadQuotePartToModelText } from "@/lib/thread-chat/application/quote-model"
import {
  assertPromptWindowBudget,
  estimatePromptTokens,
} from "@/lib/thread-chat/application/quote-budget"
import {
  canonicalHash,
  modelMessagesCharacters,
  promptSegment,
  stablePrefixHash,
  stableStringify,
  type PromptManifest,
  type PromptSegment,
} from "@/lib/thread-chat/application/prompt-cache"
import { parseThreadQuoteData } from "@/lib/thread-chat/domain/thread-quote"
import {
  loadProjectMessagesByIds,
  listThreadMessageRows,
} from "@/lib/thread-chat/persistence/message-repository"
import { findOwnedThread } from "@/lib/thread-chat/persistence/thread-repository"

function messageText(message: ThreadChatUIMessage): string {
  return message.parts
    .filter(
      (
        part
      ): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
}

function asUiMessage(row: {
  id: string
  role: "user" | "assistant"
  parts: ThreadChatUIMessage["parts"]
}): ThreadChatUIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: stripTransientParts(row.parts),
    metadata: { messageId: row.id, threadId: "context" },
  }
}

async function convertUiMessages(
  messages: ThreadChatUIMessage[]
): Promise<ModelMessage[]> {
  return convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    convertDataPart: (part) => {
      if (part.type !== "data-quote") return undefined
      return {
        type: "text",
        text: threadQuotePartToModelText(part.data),
      }
    },
  })
}

function withLegacyBranchOrigin(input: {
  thread: NonNullable<Awaited<ReturnType<typeof findOwnedThread>>>
  currentUser: ThreadChatUIMessage
  hasPriorUser: boolean
}): ThreadChatUIMessage {
  const { thread, currentUser, hasPriorUser } = input
  if (
    hasPriorUser ||
    !thread.parentId ||
    !thread.forkMessageId ||
    !thread.forkAnchor ||
    !thread.anchorText ||
    currentUser.parts.some((part) => part.type === "data-quote")
  ) {
    return currentUser
  }
  const origin = buildBranchOriginQuote({
    projectId: thread.projectId,
    parentThreadId: thread.parentId,
    sourceMessageId: thread.forkMessageId,
    anchor: thread.forkAnchor,
    anchorText: thread.anchorText,
    quoteId: thread.id,
  })
  return {
    ...currentUser,
    parts: [{ type: "data-quote", data: origin }, ...currentUser.parts],
  }
}

export type PromptBase = {
  system: string
  inheritedMessages: ModelMessage[]
  branchHistoryMessages: ModelMessage[]
  currentUserMessage: ModelMessage
  currentUserQuoteCount: number
  currentUserQuoteCharacters: number
  baseSegments: PromptSegment[]
  forkContextHash: string
}

export async function compilePromptBase(input: {
  userId: string
  threadId: string
  excludeAssistantMessageId?: string
}): Promise<PromptBase> {
  const thread = await findOwnedThread(db, input.userId, input.threadId)
  if (!thread) notFound()

  const inheritedRows = await loadProjectMessagesByIds(
    db,
    thread.projectId,
    thread.forkContext
  )
  const byId = new Map(inheritedRows.map((message) => [message.id, message]))
  const inherited = thread.forkContext.map((id) => byId.get(id))
  if (inherited.some((message) => !message)) {
    stateConflict("冻结分支上下文不完整")
  }
  const inheritedUi = inherited.map((row) => asUiMessage(row!))
  const budgeted = applyInheritedBudget(
    inheritedUi,
    messageText,
    INHERITED_CHAR_BUDGET
  )
  const inheritedWithNotice: ThreadChatUIMessage[] = [
    ...(budgeted.omitted > 0
      ? [
          {
            id: "inherited-omitted",
            role: "user" as const,
            parts: [
              {
                type: "text" as const,
                text: omittedNoticeText(budgeted.omitted),
              },
            ],
            metadata: {
              messageId: "inherited-omitted",
              threadId: thread.id,
            },
          },
        ]
      : []),
    ...budgeted.kept,
  ]

  const currentRows = await listThreadMessageRows(db, thread.projectId, thread.id)
  const currentUi = currentRows
    .filter(
      (message) =>
        message.supersededAt === null &&
        message.id !== input.excludeAssistantMessageId
    )
    .map(asUiMessage)
  const currentUserIndex = currentUi.findLastIndex(
    (message) => message.role === "user"
  )
  if (currentUserIndex === -1) stateConflict("生成缺少当前用户消息")
  const branchHistoryUi = currentUi.slice(0, currentUserIndex)
  const currentUserUi = withLegacyBranchOrigin({
    thread,
    currentUser: currentUi[currentUserIndex],
    hasPriorUser: branchHistoryUi.some((message) => message.role === "user"),
  })

  // Stable segments never use the current question for RAG. Their attachment text
  // must be byte-for-byte deterministic for sibling and continuation reuse.
  const [resolvedInherited, resolvedBranchHistory, resolvedCurrentUser] =
    await Promise.all([
      resolveAttachmentParts(inheritedWithNotice, input.userId, {
        allowRetrieval: false,
      }),
      resolveAttachmentParts(branchHistoryUi, input.userId, {
        allowRetrieval: false,
      }),
      resolveAttachmentParts([currentUserUi], input.userId, {
        allowRetrieval: true,
        query: messageText(currentUserUi),
      }),
    ])
  const [inheritedMessages, branchHistoryMessages, currentUserMessages] =
    await Promise.all([
      convertUiMessages(resolvedInherited as ThreadChatUIMessage[]),
      convertUiMessages(resolvedBranchHistory as ThreadChatUIMessage[]),
      convertUiMessages(resolvedCurrentUser as ThreadChatUIMessage[]),
    ])
  if (currentUserMessages.length !== 1) {
    stateConflict("当前用户消息编译结果不唯一")
  }

  const quoteParts = currentUserUi.parts.filter(
    (part) => part.type === "data-quote"
  )
  const currentQuotes = quoteParts.map((part) => parseThreadQuoteData(part.data))
  const system = THREAD_CHAT_AGENT_KERNEL
  const baseSegments = [
    promptSegment({
      kind: "agent-kernel",
      stability: "stable-prefix",
      version: THREAD_AGENT_KERNEL_VERSION,
      content: system,
      messageCount: 1,
    }),
    promptSegment({
      kind: "inherited-history",
      stability: "stable-prefix",
      version: THREAD_PROMPT_COMPILER_VERSION,
      content: inheritedMessages,
      messageCount: inheritedMessages.length,
    }),
    promptSegment({
      kind: "branch-history",
      stability: "stable-prefix",
      version: THREAD_PROMPT_COMPILER_VERSION,
      content: branchHistoryMessages,
      messageCount: branchHistoryMessages.length,
    }),
  ]

  return {
    system,
    inheritedMessages,
    branchHistoryMessages,
    currentUserMessage: currentUserMessages[0],
    currentUserQuoteCount: currentQuotes.length,
    currentUserQuoteCharacters: currentQuotes.reduce(
      (total, quote) =>
        total +
        quote.text.length +
        (quote.schemaVersion === "legacy" ? 0 : (quote.comment?.length ?? 0)),
      0
    ),
    baseSegments,
    forkContextHash: canonicalHash(inheritedMessages),
  }
}

export type CompiledGenerationPrompt = {
  system: string
  messages: ModelMessage[]
  tools: ToolSet
  providerOptions?: PromptProviderOptions
  headers?: Record<string, string>
  manifest: PromptManifest
}

export function buildRuntimeControl(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return [
    '<runtime_control version="thread-runtime-v1">',
    stableStringify(value),
    "</runtime_control>",
  ].join("\n")
}

export function finalizeGenerationPrompt(input: {
  base: PromptBase
  tools: ToolSet
  toolProfileId: string
  toolProfileHash: string
  routeId: string
  runtimeControl?: unknown
  providerOptions?: PromptProviderOptions
  headers?: Record<string, string>
  contextWindowTokens?: number
  minimumCachePrefixTokens?: number
}): CompiledGenerationPrompt {
  const runtimeText = buildRuntimeControl(input.runtimeControl)
  const runtimeMessages: ModelMessage[] = runtimeText
    ? [{ role: "user", content: runtimeText }]
    : []
  const stableMessages = [
    ...input.base.inheritedMessages,
    ...input.base.branchHistoryMessages,
  ]
  const messages = [
    ...stableMessages,
    ...runtimeMessages,
    input.base.currentUserMessage,
  ]
  const runtimeSegment = promptSegment({
    kind: "runtime-control",
    stability: "dynamic-tail",
    version: "thread-runtime-v1",
    content: runtimeMessages,
    messageCount: runtimeMessages.length,
  })
  const currentUserSegment = promptSegment({
    kind: "current-user",
    stability: "dynamic-tail",
    version: THREAD_PROMPT_COMPILER_VERSION,
    content: input.base.currentUserMessage,
    messageCount: 1,
  })
  const toolCharacters = stableStringify(input.tools).length
  const kernelCharacters = input.base.baseSegments[0].characters
  const inheritedCharacters = input.base.baseSegments[1].characters
  const branchHistoryCharacters = input.base.baseSegments[2].characters
  const stablePrefixCharacters =
    toolCharacters +
    kernelCharacters +
    inheritedCharacters +
    branchHistoryCharacters
  const stablePrefixTokenEstimate = Math.ceil(
    stablePrefixCharacters / THREAD_PROMPT_CHARACTERS_PER_TOKEN_ESTIMATE
  )
  const minimumCachePrefixTokens = input.minimumCachePrefixTokens ?? 0
  const eligible = stablePrefixTokenEstimate >= minimumCachePrefixTokens
  const inputCharacters = stableStringify({
    system: input.base.system,
    messages,
    tools: input.tools,
  }).length
  assertPromptWindowBudget({
    inputCharacters,
    contextWindowTokens: input.contextWindowTokens,
  })

  const manifest: PromptManifest = {
    promptCompilerVersion: THREAD_PROMPT_COMPILER_VERSION,
    agentKernelVersion: THREAD_AGENT_KERNEL_VERSION,
    quoteProtocolVersion: "thread-quote-v1",
    quoteModelFormatVersion: "thread-quote-model-v1",
    quoteBudgetPolicyVersion: "thread-quote-budget-v1",
    promptCacheProfileVersion: "thread-prompt-cache-v1",
    toolProfileId: input.toolProfileId,
    toolProfileHash: input.toolProfileHash,
    routeId: input.routeId,
    segments: [...input.base.baseSegments, runtimeSegment, currentUserSegment],
    forkContextHash: input.base.forkContextHash,
    stableRequestPrefixHash: stablePrefixHash({
      toolProfileId: input.toolProfileId,
      toolProfileHash: input.toolProfileHash,
      system: input.base.system,
      inheritedMessages: input.base.inheritedMessages,
      branchHistoryMessages: input.base.branchHistoryMessages,
    }),
    stablePrefixCharacters,
    stablePrefixTokenEstimate,
    currentUserQuoteCount: input.base.currentUserQuoteCount,
    currentUserQuoteCharacters: input.base.currentUserQuoteCharacters,
    candidateBoundaries: [
      {
        kind: "kernel-end",
        characterOffset: toolCharacters + kernelCharacters,
        tokenEstimate: estimatePromptTokens(toolCharacters + kernelCharacters),
      },
      {
        kind: "inherited-end",
        characterOffset:
          toolCharacters + kernelCharacters + inheritedCharacters,
        tokenEstimate: estimatePromptTokens(
          toolCharacters + kernelCharacters + inheritedCharacters
        ),
      },
      {
        kind: "branch-history-end",
        characterOffset: stablePrefixCharacters,
        tokenEstimate: stablePrefixTokenEstimate,
      },
    ],
    cacheEligibility: {
      eligible,
      reason: eligible ? "eligible" : "below-minimum",
    },
  }
  return {
    system: input.base.system,
    messages,
    tools: input.tools,
    ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
    manifest,
  }
}

export function promptBaseCharacters(base: PromptBase): number {
  return (
    base.system.length +
    modelMessagesCharacters(base.inheritedMessages) +
    modelMessagesCharacters(base.branchHistoryMessages) +
    modelMessagesCharacters([base.currentUserMessage])
  )
}
