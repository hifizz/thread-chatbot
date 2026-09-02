import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { messages } from "@/lib/db/schema"
import { THREAD_CHAT_CHECKPOINT_THROTTLE_MS } from "@/constants/thread-chat-stream"
import type { ThreadChatUIMessage } from "@/lib/thread-chat/contracts/ui-message"
import { stripTransientParts } from "@/lib/thread-chat/application/command-utils"

export type CheckpointWriter = (
  messageId: string,
  parts: ThreadChatUIMessage["parts"]
) => Promise<boolean>

export type CheckpointSummary = {
  scheduledSnapshots: number
  writeAttempts: number
  successfulWrites: number
  finalPartCount: number
  finalSerializedBytes: number
}

async function writeCheckpoint(
  messageId: string,
  parts: ThreadChatUIMessage["parts"]
): Promise<boolean> {
  const [updated] = await db
    .update(messages)
    .set({ parts, updatedAt: new Date() })
    .where(and(eq(messages.id, messageId), eq(messages.status, "generating")))
    .returning({ id: messages.id })
  return Boolean(updated)
}

export class MessageCheckpointer {
  private pending: ThreadChatUIMessage["parts"] | null = null
  private pendingSerialized: string | null = null
  private lastWritten = "[]"
  private lastWriteAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private writeChain = Promise.resolve(true)
  private active = true
  private summary: CheckpointSummary = {
    scheduledSnapshots: 0,
    writeAttempts: 0,
    successfulWrites: 0,
    finalPartCount: 0,
    finalSerializedBytes: 0,
  }

  constructor(
    private readonly messageId: string,
    private readonly writer: CheckpointWriter = writeCheckpoint,
    private readonly throttleMs = THREAD_CHAT_CHECKPOINT_THROTTLE_MS,
    private readonly now: () => number = Date.now
  ) {}

  schedule(snapshot: ThreadChatUIMessage): void {
    if (!this.active) return
    const parts = stripTransientParts(snapshot.parts)
    const serialized = JSON.stringify(parts)
    if (
      serialized === this.lastWritten ||
      serialized === this.pendingSerialized
    )
      return
    this.summary.scheduledSnapshots += 1
    this.summary.finalPartCount = parts.length
    this.summary.finalSerializedBytes = new TextEncoder().encode(
      serialized
    ).byteLength
    this.pending = structuredClone(parts)
    this.pendingSerialized = serialized
    if (this.timer) return
    const delay = Math.max(0, this.throttleMs - (this.now() - this.lastWriteAt))
    this.timer = setTimeout(() => {
      this.timer = null
      void this.writePending()
    }, delay)
    this.timer.unref?.()
  }

  async flush(snapshot?: ThreadChatUIMessage): Promise<boolean> {
    if (snapshot && this.active) {
      const parts = stripTransientParts(snapshot.parts)
      const serialized = JSON.stringify(parts)
      if (serialized !== this.lastWritten) {
        if (serialized !== this.pendingSerialized)
          this.summary.scheduledSnapshots += 1
        this.summary.finalPartCount = parts.length
        this.summary.finalSerializedBytes = new TextEncoder().encode(
          serialized
        ).byteLength
        this.pending = structuredClone(parts)
        this.pendingSerialized = serialized
      }
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.writePending()
    return this.writeChain
  }

  stop(): void {
    this.active = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
    this.pendingSerialized = null
  }

  getSummary(): CheckpointSummary {
    return { ...this.summary }
  }

  private async writePending(): Promise<void> {
    const parts = this.pending
    const serialized = this.pendingSerialized
    this.pending = null
    this.pendingSerialized = null
    if (!parts || !serialized || serialized === this.lastWritten) return
    this.writeChain = this.writeChain.then(async (stillGenerating) => {
      if (!stillGenerating) return false
      this.summary.writeAttempts += 1
      const updated = await this.writer(this.messageId, parts)
      if (updated) {
        this.summary.successfulWrites += 1
        this.lastWritten = serialized
        this.lastWriteAt = this.now()
      } else {
        this.active = false
      }
      return updated
    })
    await this.writeChain
  }
}
