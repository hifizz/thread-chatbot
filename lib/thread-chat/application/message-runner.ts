import type { UIMessage } from "ai"
import { toMarkdownArtifactToolOutput } from "../domain/artifact"
import { invariant } from "../domain/domain-error"
import type { MessageRun } from "../domain/message-run"
import {
  createThreadChatRepositories,
  type ThreadChatSql,
  type ThreadChatUnitOfWork,
} from "../infrastructure/repositories"
import { loadPromptHistory } from "./prompt-history"
import type { AiRuntime } from "./ports/ai-runtime"

export type MessageRunExecutionResult =
  | { outcome: "not_claimed" }
  | { outcome: "completed" | "failed" | "stopped"; run: MessageRun }

export class MessageRunner {
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly sql: ThreadChatSql,
    private readonly unitOfWork: ThreadChatUnitOfWork,
    private readonly runtime: AiRuntime,
    private readonly dependencies: {
      generateId: () => string
      now: () => Date
      heartbeatIntervalMs?: number
    }
  ) {}

  async execute(messageRunId: string): Promise<MessageRunExecutionResult> {
    const repositories = createThreadChatRepositories(this.sql)
    const context = await repositories.messageRuns.findExecutionContext(
      messageRunId
    )
    if (!context) return { outcome: "not_claimed" }
    const claimed = await repositories.messageRuns.transition({
      actorId: context.actorId,
      messageRunId,
      expectedStatus: "queued",
      nextStatus: "running",
    })
    if (!claimed) return { outcome: "not_claimed" }

    const controller = new AbortController()
    this.controllers.set(messageRunId, controller)
    const heartbeatTimer = setInterval(() => {
      void repositories.messageRuns
        .heartbeat({
          actorId: context.actorId,
          messageRunId,
          heartbeatAt: this.dependencies.now(),
        })
        .catch(() => undefined)
    }, this.dependencies.heartbeatIntervalMs ?? 15_000)
    heartbeatTimer.unref()

    try {
      const promptMessages = await loadPromptHistory(this.sql, {
        actorId: context.actorId,
        threadId: context.threadId,
      })
      let checkpointParts = claimed.checkpointParts
      let eventSequence = claimed.eventSequence
      const artifactParts: UIMessage["parts"] = []
      const events = this.runtime.execute(
        {
          messageRunId,
          assistantMessageId: claimed.assistantMessageId,
          modelId: claimed.modelId,
          prompt: promptMessages.map((message) => ({
            id: message.id,
            role: message.role,
            parts: message.parts ?? [],
          })),
        },
        { signal: controller.signal }
      )

      for await (const event of events) {
        if (await this.stopWasRequested(context.actorId, messageRunId)) {
          controller.abort()
          return this.finish(context.actorId, claimed, "stopped")
        }

        if (event.type === "delta") {
          checkpointParts = [...checkpointParts, ...event.partsDelta]
          const checkpointed = await repositories.messageRuns.checkpoint({
            actorId: context.actorId,
            messageRunId,
            expectedEventSequence: eventSequence,
            checkpointParts,
            heartbeatAt: this.dependencies.now(),
          })
          if (!checkpointed) return { outcome: "not_claimed" }
          eventSequence = checkpointed.eventSequence
          continue
        }

        if (event.type === "artifact") {
          const artifact = await this.unitOfWork.transaction(async (tx) => {
            const created = await tx.artifacts.insert({
              actorId: context.actorId,
              id: this.dependencies.generateId(),
              projectId: context.projectId,
              sourceMessageId: claimed.assistantMessageId,
              kind: event.output.kind,
              title: event.output.title,
              content: event.output.content,
            })
            const toolPart = {
              type: "dynamic-tool" as const,
              toolName: "createMarkdownArtifact",
              toolCallId: event.output.toolCallId ?? created.id,
              state: "output-available" as const,
              input: { title: event.output.title },
              output: toMarkdownArtifactToolOutput(created),
            }
            artifactParts.push(toolPart)
            checkpointParts = [...checkpointParts, toolPart]
            const checkpointed = await tx.messageRuns.checkpoint({
              actorId: context.actorId,
              messageRunId,
              expectedEventSequence: eventSequence,
              checkpointParts,
              heartbeatAt: this.dependencies.now(),
            })
            invariant(
              checkpointed,
              "message_run_transition_invalid",
              "Artifact checkpoint 写入时 MessageRun 已改变。"
            )
            return { artifact: created, checkpointed }
          })
          eventSequence = artifact.checkpointed.eventSequence
          continue
        }

        if (event.type === "completed") {
          return this.complete(
            context.actorId,
            claimed,
            [...artifactParts, ...event.parts]
          )
        }
        if (event.type === "failed") {
          return this.finish(context.actorId, claimed, "failed", event.error)
        }
        return this.finish(context.actorId, claimed, "stopped")
      }

      return this.finish(context.actorId, claimed, "failed", {
        code: "runtime_ended_without_terminal_event",
        message: "AI Runtime 未产生终态事件。",
      })
    } catch (error) {
      if (
        controller.signal.aborted ||
        (await this.stopWasRequested(context.actorId, messageRunId))
      ) {
        return this.finish(context.actorId, claimed, "stopped")
      }
      return this.finish(context.actorId, claimed, "failed", {
        code: "runtime_execution_failed",
        message: error instanceof Error ? error.message : "AI Runtime 执行失败。",
      })
    } finally {
      clearInterval(heartbeatTimer)
      this.controllers.delete(messageRunId)
    }
  }

  async scanQueued(limit = 20): Promise<PromiseSettledResult<MessageRunExecutionResult>[]> {
    const ids = await createThreadChatRepositories(
      this.sql
    ).messageRuns.listQueuedIds(limit)
    return Promise.allSettled(ids.map((id) => this.execute(id)))
  }

  async requestStop(input: {
    actorId: string
    assistantMessageId: string
  }): Promise<MessageRun> {
    const run = await this.unitOfWork.transaction(async (repositories) => {
      const requested = await repositories.messageRuns.requestStop(
        input.actorId,
        input.assistantMessageId,
        this.dependencies.now()
      )
      if (!requested) {
        const current =
          await repositories.messageRuns.findOwnedByAssistantMessageId(
            input.actorId,
            input.assistantMessageId
          )
        invariant(current, "entity_not_found", "MessageRun 不存在。")
        return current
      }
      if (requested.status !== "queued") return requested
      const stopped = await repositories.messageRuns.transition({
        actorId: input.actorId,
        messageRunId: requested.id,
        expectedStatus: "queued",
        nextStatus: "stopped",
        finishedAt: this.dependencies.now(),
        incrementEventSequence: true,
      })
      invariant(
        stopped,
        "message_run_transition_invalid",
        "queued MessageRun Stop 转换失败。"
      )
      return stopped
    })
    this.controllers.get(run.id)?.abort()
    return run
  }

  private async stopWasRequested(
    actorId: string,
    messageRunId: string
  ): Promise<boolean> {
    const context = await createThreadChatRepositories(
      this.sql
    ).messageRuns.findExecutionContext(messageRunId)
    return context?.actorId === actorId && context.run.stopRequestedAt !== null
  }

  private complete(
    actorId: string,
    claimed: MessageRun,
    finalParts: UIMessage["parts"]
  ): Promise<MessageRunExecutionResult> {
    return this.unitOfWork.transaction(async (repositories) => {
      const message = await repositories.messages.finalizeAssistantOnce({
        actorId,
        messageId: claimed.assistantMessageId,
        parts: finalParts,
        finalizedAt: this.dependencies.now(),
      })
      invariant(
        message,
        "message_run_transition_invalid",
        "assistant Message 无法封存。"
      )
      const run = await repositories.messageRuns.transition({
        actorId,
        messageRunId: claimed.id,
        expectedStatus: "running",
        nextStatus: "completed",
        finishedAt: this.dependencies.now(),
        incrementEventSequence: true,
      })
      invariant(
        run,
        "message_run_transition_invalid",
        "MessageRun completed 条件更新失败。"
      )
      return { outcome: "completed", run }
    })
  }

  private async finish(
    actorId: string,
    claimed: MessageRun,
    outcome: "failed" | "stopped",
    error?: { code: string; message: string }
  ): Promise<MessageRunExecutionResult> {
    const repositories = createThreadChatRepositories(this.sql)
    const run = await repositories.messageRuns.transition({
      actorId,
      messageRunId: claimed.id,
      expectedStatus: "running",
      nextStatus: outcome,
      finishedAt: this.dependencies.now(),
      error: outcome === "failed" ? error : null,
      incrementEventSequence: true,
    })
    if (run) return { outcome, run }
    const current = await repositories.messageRuns.findExecutionContext(
      claimed.id
    )
    invariant(current, "entity_not_found", "MessageRun 不存在。")
    return { outcome: current.run.status as "failed" | "stopped", run: current.run }
  }
}
