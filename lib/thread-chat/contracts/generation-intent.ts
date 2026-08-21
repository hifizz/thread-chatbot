import { z } from "zod"

/**
 * Thread Chat generation 命令的唯一运行时契约。
 * TypeScript 类型必须由该 schema 推导，避免客户端类型与 API 校验漂移。
 */
export const threadChatGenerationIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("persisted-turn") }),
  z.object({
    kind: z.literal("regenerate-assistant"),
    sourceAssistantMessageId: z.string().min(1),
  }),
  z.object({ kind: z.literal("retry-orphan-user") }),
  z.object({
    kind: z.literal("edit-last-user"),
    sourceUserMessageId: z.string().min(1),
    text: z.string().trim().min(1),
  }),
])

export type ThreadChatGenerationIntent = z.infer<
  typeof threadChatGenerationIntentSchema
>
