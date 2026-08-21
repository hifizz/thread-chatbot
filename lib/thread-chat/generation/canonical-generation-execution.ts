import {
  CONVERSATION_GENERATION_DEFAULT_CHECKPOINT_THROTTLE_MS,
  CONVERSATION_GENERATION_DEFAULT_HEARTBEAT_MS,
  CONVERSATION_GENERATION_DEFAULT_LEASE_MS,
} from "../../../constants/conversation-generation"
import type {
  CanonicalGenerationExecutor,
  CanonicalGenerationRecord,
  CanonicalGenerationRepository,
  FinalizeCanonicalGenerationInput,
  GenerationAbortRegistry,
  StartCanonicalGenerationInput,
} from "../application/conversation-generation-service"
import { CanonicalGenerationServiceError } from "../application/conversation-generation-service"
import type { ConversationGenerationCheckpoint } from "../domain/conversation-generation"
import { inferUsageCompleteness } from "../domain/conversation-generation"
import type { GenerationId } from "../domain/conversation-model"

export interface CanonicalGenerationExecutionOptions {
  readonly checkpointThrottleMs?: number
  readonly heartbeatMs?: number
  readonly leaseMs?: number
  readonly now?: () => number
}

export interface StartedCanonicalGeneration {
  readonly generation: CanonicalGenerationRecord
  /** 幂等重放没有新的执行；新建任务的 Promise 与任何 HTTP 响应生命周期无关。 */
  readonly execution: Promise<CanonicalGenerationRecord | null> | null
}

export class InMemoryGenerationAbortRegistry implements GenerationAbortRegistry {
  private readonly controllers = new Map<GenerationId, AbortController>()

  register(generationId: GenerationId, controller: AbortController): void {
    this.controllers.set(generationId, controller)
  }

  abort(generationId: GenerationId): boolean {
    const controller = this.controllers.get(generationId)
    if (!controller) return false
    controller.abort()
    return true
  }

  unregister(generationId: GenerationId, controller: AbortController): void {
    if (this.controllers.get(generationId) === controller)
      this.controllers.delete(generationId)
  }
}

class VersionedCheckpointWriter {
  private version: number
  private latest: ConversationGenerationCheckpoint
  private lastSavedAt: number
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: Promise<void> = Promise.resolve()

  constructor(
    private readonly repository: CanonicalGenerationRepository,
    private readonly generationId: GenerationId,
    private readonly leaseOwner: string,
    initialVersion: number,
    initialCheckpoint: ConversationGenerationCheckpoint,
    private readonly throttleMs: number,
    private readonly now: () => number
  ) {
    this.version = initialVersion
    this.latest = initialCheckpoint
    this.lastSavedAt = this.now()
  }

  get checkpoint(): ConversationGenerationCheckpoint {
    return this.latest
  }

  get checkpointVersion(): number {
    return this.version
  }

  accept(checkpoint: ConversationGenerationCheckpoint): Promise<void> {
    this.latest = checkpoint
    this.dirty = true
    if (this.now() - this.lastSavedAt >= this.throttleMs) return this.flush()
    if (!this.timer)
      this.timer = setTimeout(
        () => {
          this.timer = null
          void this.flush().catch(() => {
            // close() 会等待同一 pending 链并把错误交给执行生命周期处理。
          })
        },
        Math.max(0, this.throttleMs - (this.now() - this.lastSavedAt))
      )
    return Promise.resolve()
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return this.pending
    const checkpoint = this.latest
    this.dirty = false
    this.pending = this.pending.then(async () => {
      const result = await this.repository.saveCheckpoint({
        generationId: this.generationId,
        leaseOwner: this.leaseOwner,
        expectedVersion: this.version,
        checkpoint,
      })
      if (result.kind === "saved") {
        this.version = result.version
        this.lastSavedAt = this.now()
        return
      }
      if (result.kind === "terminal") return
      throw new CanonicalGenerationServiceError(
        "checkpoint_conflict",
        `checkpoint 版本冲突：期望 ${this.version}，实际 ${result.version}`
      )
    })
    return this.pending
  }

  async close(): Promise<void> {
    await this.flush()
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  )
}

/**
 * 规范 Generation 的隔离组合根。它不接收 request.signal，因此浏览器断线不会取消模型；
 * 公开命令路由只负责调用 start/stop/query，不拥有执行生命周期。
 */
export class CanonicalGenerationApplicationService {
  private readonly checkpointThrottleMs: number
  private readonly heartbeatMs: number
  private readonly leaseMs: number
  private readonly now: () => number

  constructor(
    private readonly repository: CanonicalGenerationRepository,
    private readonly executor: CanonicalGenerationExecutor,
    private readonly abortRegistry: GenerationAbortRegistry,
    options: CanonicalGenerationExecutionOptions = {}
  ) {
    this.checkpointThrottleMs =
      options.checkpointThrottleMs ??
      CONVERSATION_GENERATION_DEFAULT_CHECKPOINT_THROTTLE_MS
    this.heartbeatMs =
      options.heartbeatMs ?? CONVERSATION_GENERATION_DEFAULT_HEARTBEAT_MS
    this.leaseMs = options.leaseMs ?? CONVERSATION_GENERATION_DEFAULT_LEASE_MS
    this.now = options.now ?? Date.now
  }

  async start(
    input: StartCanonicalGenerationInput
  ): Promise<StartedCanonicalGeneration> {
    const started = await this.repository.startGeneration(input)
    if (!started.created)
      return { generation: started.generation, execution: null }

    // startGeneration 的事务已经提交，之后才允许声明并进入付费调用。
    const execution = this.run(started.generation, input.leaseOwner)
    return { generation: started.generation, execution }
  }

  async query(input: {
    readonly ownerId: string
    readonly generationId: GenerationId
  }): Promise<CanonicalGenerationRecord | null> {
    return this.repository.getGeneration(input)
  }

  async stop(input: {
    readonly ownerId: string
    readonly generationId: GenerationId
  }): Promise<CanonicalGenerationRecord | null> {
    const persisted = await this.repository.requestStop(input)
    if (persisted?.status === "stop_requested")
      this.abortRegistry.abort(input.generationId)
    return persisted
  }

  async convergeStale(input: {
    readonly generationId: GenerationId
    readonly leaseOwner: string
  }): Promise<CanonicalGenerationRecord | null> {
    const claimed = await this.repository.claimStale({
      generationId: input.generationId,
      leaseOwner: input.leaseOwner,
      staleBefore: new Date(this.now() - this.leaseMs),
    })
    if (!claimed) return null
    return this.repository.finalizeGeneration({
      generationId: claimed.id,
      leaseOwner: input.leaseOwner,
      expectedCheckpointVersion: claimed.checkpointVersion,
      outcome: claimed.status === "stop_requested" ? "stopped" : "failed",
      checkpoint: claimed.checkpoint,
      usageCompleteness: claimed.usageCompleteness,
      knownUsage: claimed.knownUsage,
      errorCode:
        claimed.status === "stop_requested"
          ? "stop_converged"
          : "lease_expired",
    })
  }

  private async run(
    generation: CanonicalGenerationRecord,
    leaseOwner: string
  ): Promise<CanonicalGenerationRecord | null> {
    const controller = new AbortController()
    const writer = new VersionedCheckpointWriter(
      this.repository,
      generation.id,
      leaseOwner,
      generation.checkpointVersion,
      generation.checkpoint,
      this.checkpointThrottleMs,
      this.now
    )
    this.abortRegistry.register(generation.id, controller)
    let heartbeatRunning = false
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return
      heartbeatRunning = true
      void Promise.all([
        this.repository.heartbeat({ generationId: generation.id, leaseOwner }),
        this.repository.getGeneration({
          ownerId: generation.ownerId,
          generationId: generation.id,
        }),
      ])
        .then(([, current]) => {
          if (current?.status === "stop_requested") controller.abort()
        })
        .finally(() => {
          heartbeatRunning = false
        })
    }, this.heartbeatMs)

    let finalize: Omit<
      FinalizeCanonicalGenerationInput,
      "generationId" | "leaseOwner" | "expectedCheckpointVersion"
    >
    try {
      const paidCallAccepted = await this.repository.markPaidCallStarted({
        generationId: generation.id,
        leaseOwner,
      })
      if (!paidCallAccepted)
        throw new CanonicalGenerationServiceError(
          "version_conflict",
          "Generation 在模型执行前已失去租约或不再运行"
        )
      const result = await this.executor.execute({
        generation: { ...generation, paidCallStarted: true },
        signal: controller.signal,
        onCheckpoint: (checkpoint) => writer.accept(checkpoint),
      })
      const checkpoint = {
        ...result.checkpoint,
        knownUsage: result.knownUsage,
      }
      await writer.accept(checkpoint)
      finalize = { ...result, checkpoint }
    } catch (error) {
      const current = await this.repository.getGeneration({
        ownerId: generation.ownerId,
        generationId: generation.id,
      })
      finalize = {
        outcome:
          current?.status === "stop_requested" || isAbortError(error)
            ? "stopped"
            : "failed",
        checkpoint: writer.checkpoint,
        usageCompleteness: inferUsageCompleteness(writer.checkpoint.knownUsage),
        knownUsage: writer.checkpoint.knownUsage,
        errorCode:
          current?.status === "stop_requested" || isAbortError(error)
            ? "stopped"
            : error instanceof Error
              ? error.name
              : "unknown_error",
      }
    } finally {
      clearInterval(heartbeat)
      this.abortRegistry.unregister(generation.id, controller)
    }

    await writer.close()
    return this.repository.finalizeGeneration({
      generationId: generation.id,
      leaseOwner,
      expectedCheckpointVersion: writer.checkpointVersion,
      ...finalize,
    })
  }
}
