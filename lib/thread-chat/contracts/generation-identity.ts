import { z } from "zod"
import { threadChatGenerationIntentSchema } from "@/lib/thread-chat/contracts/generation-intent"

/** Thread Chat 生成请求定位持久化 turn 的唯一运行时契约。 */
export const threadChatGenerationIdentitySchema = z.object({
  anchorText: z.string().nullable().optional(),
  treeId: z.string().uuid(),
  threadId: z.string().min(1),
  userMessageId: z.string().min(1),
  assistantMessageId: z.string().min(1),
  generationId: z.string().uuid(),
  intent: threadChatGenerationIntentSchema,
})

export type ThreadChatGenerationIdentity = z.infer<
  typeof threadChatGenerationIdentitySchema
>
