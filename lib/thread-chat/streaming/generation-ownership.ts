import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { messages } from "@/lib/db/schema"
import {
  THREAD_CHAT_GENERATION_CONTROL_POLL_MS,
  THREAD_CHAT_GENERATION_HEARTBEAT_MS,
  THREAD_CHAT_GENERATION_HEARTBEAT_STALE_MS,
} from "@/constants/thread-chat-stream"
import { GENERATION_CANCEL_REASONS } from "@/constants/generation"
import type { GenerationCancelReason } from "@/lib/ai/generation-cancellation"
import { getInstanceId } from "@/lib/runtime/instance"

/**
 * 多实例生成所有权（lease）。
 *
 * - 生成启动时 CAS 认领 generationOwner，运行中按 HEARTBEAT 间隔刷新心跳；
 * - 同一行上的 stopRequestedAt / supersededAt 是跨实例控制通道：
 *   任何实例写标志，属主实例在控制轮询里读到后本地 abort；
 * - 心跳过期即属主已死，允许清扫/接管（见 runtime.ts 的 sweeper）。
 *
 * 这不是第二套任务队列：终态仍只由 finalize 的 status CAS 写入。
 */

type ControlFlags = {
  stopRequestedAt: Date | null
  supersededAt: Date | null
}

export type ControlSignalReason = GenerationCancelReason

export function heartbeatStaleBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - THREAD_CHAT_GENERATION_HEARTBEAT_STALE_MS)
}

/** generating 行是否仍被活实例持有（用于 stop/stream 误判保护）。 */
export function generationHeartbeatLive(input: {
  generationHeartbeatAt: Date | null
  now?: Date
}): boolean {
  if (!input.generationHeartbeatAt) return false
  const now = input.now ?? new Date()
  return (
    input.generationHeartbeatAt.getTime() > heartbeatStaleBefore(now).getTime()
  )
}

/** 孤儿判定：无心跳且行已停留超过陈旧窗口，或心跳本身已过期。 */
export function generationIsOrphaned(input: {
  generationHeartbeatAt: Date | null
  updatedAt: Date
  now?: Date
}): boolean {
  const now = input.now ?? new Date()
  const staleBefore = heartbeatStaleBefore(now)
  if (input.generationHeartbeatAt) {
    return input.generationHeartbeatAt.getTime() <= staleBefore.getTime()
  }
  return input.updatedAt.getTime() <= staleBefore.getTime()
}

/**
 * 认领一条 generating 消息的属主权。未被认领或属主心跳已死才能接管；
 * 已 terminal 或被活实例持有则返回 null（调用方按 NOT_READY 处理）。
 */
export async function claimGenerationOwnership(
  messageId: string,
  ownerId: string = getInstanceId(),
  now: Date = new Date()
): Promise<{ ownerId: string } | null> {
  const staleBefore = heartbeatStaleBefore(now)
  const [claimed] = await db
    .update(messages)
    .set({ generationOwner: ownerId, generationHeartbeatAt: now })
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.status, "generating"),
        or(
          isNull(messages.generationOwner),
          eq(messages.generationOwner, ownerId),
          lt(messages.generationHeartbeatAt, staleBefore)
        )
      )
    )
    .returning({ id: messages.id })
  return claimed ? { ownerId } : null
}

export type GenerationLease = {
  status: string
  generationOwner: string | null
  generationHeartbeatAt: Date | null
  updatedAt: Date
  stopRequestedAt: Date | null
  supersededAt: Date | null
}

/** 路由层判定用：读取一条消息当前的生成属主租约（不含正文，调用方先做对象级授权）。 */
export async function readGenerationLease(
  messageId: string
): Promise<GenerationLease | null> {
  const [row] = await db
    .select({
      status: messages.status,
      generationOwner: messages.generationOwner,
      generationHeartbeatAt: messages.generationHeartbeatAt,
      updatedAt: messages.updatedAt,
      stopRequestedAt: messages.stopRequestedAt,
      supersededAt: messages.supersededAt,
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1)
  return row ?? null
}

export interface GenerationOwnershipOptions {
  ownerId?: string
  controlPollMs?: number
  heartbeatMs?: number
}

/**
 * 生成运行期间的所有权守望：
 * - controlPollMs 周期读控制标志（便宜 SELECT）；
 * - heartbeatMs 周期在「仍属主且仍 generating」条件下刷新心跳，RETURNING 顺带读标志；
 * - 读到 stop/supersede → onSignal(reason)，由调用方 abort 对应 AbortController；
 * - 心跳 UPDATE 影响 0 行 → 已被清扫或终态化 → onOwnershipLost 后自停。
 */
export class GenerationOwnership {
  private readonly messageId: string
  private readonly ownerId: string
  private readonly signal: AbortSignal
  private readonly onSignal: (reason: ControlSignalReason) => void
  private readonly onOwnershipLost?: () => void
  private readonly controlPollMs: number
  private readonly heartbeatMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private elapsed = 0
  private stopped = false
  private inFlight: Promise<void> | null = null

  constructor(input: {
    messageId: string
    signal: AbortSignal
    onSignal: (reason: ControlSignalReason) => void
    onOwnershipLost?: () => void
    options?: GenerationOwnershipOptions
  }) {
    this.messageId = input.messageId
    this.signal = input.signal
    this.onSignal = input.onSignal
    this.onOwnershipLost = input.onOwnershipLost
    this.ownerId = input.options?.ownerId ?? getInstanceId()
    this.controlPollMs =
      input.options?.controlPollMs ?? THREAD_CHAT_GENERATION_CONTROL_POLL_MS
    this.heartbeatMs =
      input.options?.heartbeatMs ?? THREAD_CHAT_GENERATION_HEARTBEAT_MS
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.elapsed += this.controlPollMs
      this.inFlight = (
        this.elapsed % this.heartbeatMs < this.controlPollMs
          ? this.beat()
          : this.poll()
      ).catch(() => undefined)
    }, this.controlPollMs)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.inFlight?.catch(() => undefined)
  }

  private handleFlags(row: ControlFlags | undefined): void {
    if (this.stopped || this.signal.aborted || !row) return
    if (row.supersededAt) {
      this.onSignal(GENERATION_CANCEL_REASONS.supersededByEdit)
      return
    }
    if (row.stopRequestedAt) this.onSignal(GENERATION_CANCEL_REASONS.userStop)
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.signal.aborted) return
    const [row] = await db
      .select({
        stopRequestedAt: messages.stopRequestedAt,
        supersededAt: messages.supersededAt,
      })
      .from(messages)
      .where(eq(messages.id, this.messageId))
      .limit(1)
    this.handleFlags(row)
  }

  private async beat(): Promise<void> {
    if (this.stopped || this.signal.aborted) return
    const [row] = await db
      .update(messages)
      .set({ generationHeartbeatAt: sql`now()` })
      .where(
        and(
          eq(messages.id, this.messageId),
          eq(messages.status, "generating"),
          eq(messages.generationOwner, this.ownerId)
        )
      )
      .returning({
        stopRequestedAt: messages.stopRequestedAt,
        supersededAt: messages.supersededAt,
      })
    if (!row) {
      // 行已终态化/被清扫/被级联删除：视为所有权丢失，按丢弃语义中止本地工作。
      this.onOwnershipLost?.()
      if (!this.signal.aborted) {
        this.onSignal(GENERATION_CANCEL_REASONS.discarded)
      }
      // 自停：不能 await this.stop()——stop 会等待 inFlight，而 inFlight 正是本 beat，会死锁。
      this.stopped = true
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      return
    }
    this.handleFlags(row)
  }
}
