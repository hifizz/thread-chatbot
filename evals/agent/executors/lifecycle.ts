import type { AgentCase } from "@/evals/agent/schema"
import type { AgentExecutionOutput } from "@/evals/agent/result"
import {
  assertEvaluationDatabaseGuard,
  evaluationDatabaseUrl,
} from "@/evals/agent/isolation"
import { GENERATION_CANCEL_REASONS } from "@/constants/generation"
import { assistantMessageTraceId } from "@/lib/observability/identity"

function completedStream(text: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "start" })
      controller.enqueue({ type: "text-start", id: "eval-text" })
      controller.enqueue({ type: "text-delta", id: "eval-text", text })
      controller.enqueue({ type: "text-end", id: "eval-text" })
      controller.enqueue({
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      })
      controller.close()
    },
  })
}

function failedStream() {
  return new ReadableStream({
    start(controller) {
      controller.error(new Error("synthetic lifecycle failure"))
    },
  })
}

export async function executeLifecycleCase(input: {
  evaluationCase: AgentCase
  modelId: string
  abortSignal: AbortSignal
}): Promise<AgentExecutionOutput> {
  const evalUrl = evaluationDatabaseUrl()
  const runtime = globalThis as typeof globalThis & {
    __dbClient?: unknown
  }
  if (runtime.__dbClient && process.env.DATABASE_URL !== evalUrl) {
    throw new Error(
      "Database client already initialized; run lifecycle evals in a fresh process"
    )
  }
  const { default: postgres } = await import("postgres")
  const guardClient = postgres(evalUrl, { max: 1, prepare: false })
  try {
    await assertEvaluationDatabaseGuard({
      readGuard: async () => {
        const rows = await guardClient<[{ evaluation_guard: string | null }]>`
          select current_setting('thread_chat.evaluation_guard', true)
            as evaluation_guard
        `
        return rows[0]?.evaluation_guard
      },
    })
  } finally {
    await guardClient.end()
  }
  process.env.DATABASE_URL = evalUrl

  const [drizzle, { db }, schema, application, streaming] = await Promise.all([
    import("drizzle-orm"),
    import("@/lib/db"),
    import("@/lib/db/schema"),
    import("@/lib/thread-chat/application"),
    import("@/lib/thread-chat/streaming"),
  ])
  const id = () => crypto.randomUUID()
  const userId = `eval-user-${id()}`
  const projectId = id()
  const threadId = id()
  const assistantMessageId = id()
  const latestUser = [...input.evaluationCase.input.messages]
    .reverse()
    .find((message) => message.role === "user")
  if (!latestUser) throw new Error("Lifecycle case has no user message")
  const scenario = input.evaluationCase.input.lifecycleScenario ?? "complete"

  try {
    await db.insert(schema.user).values({
      id: userId,
      name: `Evaluation ${input.evaluationCase.id}`,
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await application.startProject(userId, {
      commandId: id(),
      projectId,
      rootThreadId: threadId,
      userMessageId: id(),
      assistantMessageId,
      modelId: input.modelId,
      text: latestUser.text,
      files: [],
    })
    const store = new streaming.SessionStore({ startCleanupTimer: false })
    const run = store.start({
      messageId: assistantMessageId,
      initialSnapshot: streaming.initialAssistantSnapshot({
        messageId: assistantMessageId,
        threadId,
        modelId: input.modelId,
      }),
      run: (session) =>
        streaming.runGeneration({
          userId,
          messageId: assistantMessageId,
          session,
          dependencies: {
            prepare: async () => ({
              textStream:
                scenario === "fail"
                  ? failedStream()
                  : completedStream(
                      input.evaluationCase.fixtureResult?.text ??
                        "synthetic lifecycle output"
                    ),
              usage: Promise.resolve({
                inputTokens: 4,
                inputTokenDetails: {
                  noCacheTokens: 4,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                },
                outputTokens: 3,
                outputTokenDetails: {
                  textTokens: 3,
                  reasoningTokens: 0,
                },
                totalTokens: 7,
              }),
            }),
          },
        }),
    })
    const abortForEvaluationDeadline = () => {
      store.abort(
        assistantMessageId,
        GENERATION_CANCEL_REASONS.evaluationTimeout
      )
    }
    input.abortSignal.addEventListener(
      "abort",
      abortForEvaluationDeadline,
      { once: true }
    )
    if (input.abortSignal.aborted) abortForEvaluationDeadline()
    if (scenario === "stop") {
      store.abort(assistantMessageId, GENERATION_CANCEL_REASONS.userStop)
    }
    try {
      await run.session.task
      const terminal = await application.getMessage(userId, assistantMessageId)
      if (!terminal)
        throw new Error("Lifecycle evaluation terminal message missing")
      return {
        traceId: await assistantMessageTraceId(assistantMessageId),
        text: terminal.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
        tools: terminal.parts
          .filter((part) => part.type.startsWith("tool-"))
          .map((part) => part.type.slice("tool-".length)),
        terminalState:
          terminal.status === "generating" ? "failed" : terminal.status,
        usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      }
    } finally {
      input.abortSignal.removeEventListener(
        "abort",
        abortForEvaluationDeadline
      )
      store.dispose()
    }
  } finally {
    await db.delete(schema.user).where(drizzle.eq(schema.user.id, userId))
  }
}
