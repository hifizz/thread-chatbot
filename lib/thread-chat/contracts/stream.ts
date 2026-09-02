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
      replay: StreamReplayChunk[]
    }
  | { type: "chunk"; seq: number; chunk: ThreadChatUIMessageChunk }
  | { type: "terminal"; message: MessageDTO }
  | { type: "heartbeat"; at: string }

export interface StreamReplayChunk {
  seq: number
  chunk: ThreadChatUIMessageChunk
}

const replayChunkSchema = z
  .object({
    seq: z.number().int().positive(),
    chunk: z.custom<ThreadChatUIMessageChunk>(isThreadChatUIMessageChunk),
  })
  .strict()

const snapshotEventSchema = z
  .object({
    type: z.literal("snapshot"),
    message: z.custom<ThreadChatUIMessage>(isThreadChatUIMessage),
    throughSeq: z.number().int().min(0),
    replay: z.array(replayChunkSchema),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.replay.length !== event.throughSeq) {
      context.addIssue({
        code: "custom",
        path: ["replay"],
        message: "replay 必须覆盖 throughSeq 之前的全部 chunk",
      })
      return
    }
    for (let index = 0; index < event.replay.length; index += 1) {
      if (event.replay[index]?.seq !== index + 1)
        context.addIssue({
          code: "custom",
          path: ["replay", index, "seq"],
          message: "replay sequence 必须从 1 连续递增",
        })
    }
  })

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
