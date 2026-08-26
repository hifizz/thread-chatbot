import { z } from "zod"
import type { MessageDTO } from "@/lib/thread-chat/contracts/dto"
import {
  isThreadChatUIMessage,
  isThreadChatUIMessageChunk,
  type ThreadChatUIMessage,
  type ThreadChatUIMessageChunk,
} from "@/lib/thread-chat/contracts/ui-message"

export type StreamEvent =
  | {
      type: "snapshot"
      message: ThreadChatUIMessage
      throughSeq: number
    }
  | { type: "chunk"; seq: number; chunk: ThreadChatUIMessageChunk }
  | { type: "terminal"; message: MessageDTO }
  | { type: "heartbeat"; at: string }

const snapshotEventSchema = z
  .object({
    type: z.literal("snapshot"),
    message: z.custom<ThreadChatUIMessage>(isThreadChatUIMessage),
    throughSeq: z.number().int().min(0),
  })
  .strict()

const chunkEventSchema = z
  .object({
    type: z.literal("chunk"),
    seq: z.number().int().positive(),
    chunk: z.custom<ThreadChatUIMessageChunk>(isThreadChatUIMessageChunk),
  })
  .strict()

const terminalEventSchema = z
  .object({
    type: z.literal("terminal"),
    message: z.custom<MessageDTO>(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as Record<string, unknown>).id === "string"
    ),
  })
  .strict()

const heartbeatEventSchema = z
  .object({
    type: z.literal("heartbeat"),
    at: z.string().min(1),
  })
  .strict()

export const streamEventSchema = z.discriminatedUnion("type", [
  snapshotEventSchema,
  chunkEventSchema,
  terminalEventSchema,
  heartbeatEventSchema,
])

export function parseStreamEvent(value: unknown): StreamEvent {
  return streamEventSchema.parse(value) as StreamEvent
}

export function serializeStreamEvent(event: StreamEvent): string {
  return JSON.stringify(event)
}
