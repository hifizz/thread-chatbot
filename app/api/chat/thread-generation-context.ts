import type { UIMessage } from "ai"
import { isThreadChatModelId } from "@/constants/model"
import { compileThreadChatMessages } from "@/lib/thread-chat/application/compile-thread-chat-messages"
import { threadChatGenerationIdentitySchema } from "@/lib/thread-chat/contracts/generation-identity"
import {
  observeGenerationCancellation,
  registerGenerationController,
  unregisterGenerationController,
} from "@/lib/thread-chat-generation/execution"
import { toGenerationSummary } from "@/lib/thread-chat-generation/query-repository"
import { prepareGeneration } from "@/lib/thread-chat-generation/start-generation-repository"
import { generationStartErrorResponse } from "@/app/api/chat/generation-start-error"
import { settleGenerationInitializationFailure } from "@/app/api/chat/generation-settlement"
import type { MessageActionFailureResponse } from "@/lib/thread-chat/contracts/message-action-failure"

type ThreadGenerationContextInput = {
  userId: string
  modelId: string
  messages: UIMessage[]
  threadChat: unknown
  unbilledPreview: boolean
}

type ThreadGenerationContextDependencies = {
  threadModelAllowed: typeof isThreadChatModelId
  prepare: typeof prepareGeneration
  summarize: typeof toGenerationSummary
  compile: typeof compileThreadChatMessages
  createController(): AbortController
  register: typeof registerGenerationController
  unregister: typeof unregisterGenerationController
  observe: typeof observeGenerationCancellation
  startErrorResponse: typeof generationStartErrorResponse
  settleInitializationFailure: typeof settleGenerationInitializationFailure
}

const defaultDependencies: ThreadGenerationContextDependencies = {
  threadModelAllowed: isThreadChatModelId,
  prepare: prepareGeneration,
  summarize: toGenerationSummary,
  compile: compileThreadChatMessages,
  createController: () => new AbortController(),
  register: registerGenerationController,
  unregister: unregisterGenerationController,
  observe: observeGenerationCancellation,
  startErrorResponse: generationStartErrorResponse,
  settleInitializationFailure: settleGenerationInitializationFailure,
}

/** 校验并准备一次线性或持久化 Thread generation 的权威请求上下文。 */
export async function prepareThreadGenerationContext(
  {
    userId,
    modelId,
    messages,
    threadChat,
    unbilledPreview,
  }: ThreadGenerationContextInput,
  dependencies: ThreadGenerationContextDependencies = defaultDependencies
) {
  if (threadChat == null) {
    return {
      kind: "ready" as const,
      persistence: null,
      authoritativeMessages: messages,
      authoritativeAnchorText: null,
      preparedRevision: null,
      generationController: null,
      generationObserver: null,
    }
  }

  const parsed = threadChatGenerationIdentitySchema.safeParse(threadChat)
  if (!parsed.success) {
    return {
      kind: "response" as const,
      response: Response.json(
        {
          error: {
            code: "invalid_generation_identity",
            message: "thread-chat 请求缺少有效的持久化身份，请刷新页面后重试",
          },
        } satisfies MessageActionFailureResponse,
        { status: 400 }
      ),
    }
  }
  const persistence = parsed.data
  if (!dependencies.threadModelAllowed(modelId)) {
    return {
      kind: "response" as const,
      response: Response.json(
        {
          error: {
            code: "invalid_thread_model",
            message: "Thread Chat 不允许使用该模型，请刷新页面后重试",
          },
        } satisfies MessageActionFailureResponse,
        { status: 400 }
      ),
    }
  }

  let started: Awaited<ReturnType<typeof dependencies.prepare>>
  try {
    started = await dependencies.prepare({
      userId,
      modelId,
      ...persistence,
    })
  } catch (error) {
    return {
      kind: "response" as const,
      response: dependencies.startErrorResponse(error),
    }
  }
  if (!started.created) {
    return {
      kind: "response" as const,
      response: Response.json(
        { generation: dependencies.summarize(started.generation) },
        { status: 202 }
      ),
    }
  }

  let generationController: AbortController | null = null
  let registered = false
  try {
    const committedThread = started.state.threads[persistence.threadId]
    const authoritativeAnchorText = committedThread?.anchorText?.trim()
      ? committedThread.anchorText
      : null
    const authoritativeMessages = dependencies.compile({
      state: started.state,
      threadId: persistence.threadId,
      excludeAssistantMessageId: persistence.assistantMessageId,
    }) as UIMessage[]
    generationController = dependencies.createController()
    dependencies.register(persistence.generationId, generationController)
    registered = true
    const generationObserver = dependencies.observe(
      persistence.generationId,
      generationController
    )

    return {
      kind: "ready" as const,
      persistence,
      authoritativeMessages,
      authoritativeAnchorText,
      preparedRevision: started.revision,
      generationController,
      generationObserver,
    }
  } catch (error) {
    generationController?.abort(error)
    if (registered && generationController)
      dependencies.unregister(persistence.generationId, generationController)
    await dependencies.settleInitializationFailure({
      persistence,
      error,
      usageUnavailable: !unbilledPreview,
    })
    return {
      kind: "response" as const,
      response: Response.json(
        {
          error: {
            code: "network_error",
            message: "生成初始化失败，请重试。",
          },
        } satisfies MessageActionFailureResponse,
        { status: 500 }
      ),
    }
  }
}
