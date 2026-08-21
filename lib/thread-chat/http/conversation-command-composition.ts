import { randomUUID } from "node:crypto"

import type {
  ConversationOutboxDispatcher,
  OutboxEventConsumer,
} from "../application/conversation-command-service"
import { ConversationCommandApplicationService } from "../application/conversation-command-service"
import { generationId, type GenerationId } from "../domain/conversation-model"
import { InMemoryGenerationAbortRegistry } from "../generation/canonical-generation-execution"
import { DrizzleConversationCommandStore } from "../persistence/drizzle-conversation-command-store"
import { DrizzleConversationGenerationRepository } from "../persistence/drizzle-conversation-generation-repository"
import { DrizzleConversationOutboxDispatcher } from "../persistence/drizzle-conversation-outbox-dispatcher"
import { resolveConversationCommandApiPolicy } from "../persistence/conversation-command-policy"

declare global {
  var __conversationCommandComposition:
    | {
        service: ConversationCommandApplicationService
        dispatcher: ConversationOutboxDispatcher
        abortRegistry: InMemoryGenerationAbortRegistry
      }
    | undefined
  var __conversationOutboxConsumerOverride: OutboxEventConsumer | undefined
}

const defaultConsumer: OutboxEventConsumer = {
  async consume(event) {
    if (event.type === "GenerationRequested")
      throw new Error(
        "规范 Generation executor 尚未接入公开组合根；事件保留待重试"
      )
    // 审计/投影事件在没有外部消费者时可视为已处理；实体事务不依赖它。
  },
}

function createComposition() {
  const policy = resolveConversationCommandApiPolicy()
  const store = new DrizzleConversationCommandStore(policy)
  const generations = new DrizzleConversationGenerationRepository({
    authority: policy.authority,
    legacyAuthorityEnabled:
      process.env.BRANCH_GENERATION_AUTHORITY_ENABLED !== "false",
  })
  const abortRegistry = new InMemoryGenerationAbortRegistry()
  const dispatcher = new DrizzleConversationOutboxDispatcher(
    globalThis.__conversationOutboxConsumerOverride ?? defaultConsumer,
    `http:${randomUUID()}`
  )
  return {
    service: new ConversationCommandApplicationService(
      store,
      store,
      generations,
      dispatcher
    ),
    dispatcher,
    abortRegistry,
  }
}

export function getConversationCommandComposition() {
  const composition =
    globalThis.__conversationCommandComposition ?? createComposition()
  if (process.env.NODE_ENV !== "production")
    globalThis.__conversationCommandComposition = composition
  return composition
}

export function abortCanonicalGenerationLocally(
  targetGenerationId: GenerationId
): void {
  getConversationCommandComposition().abortRegistry.abort(targetGenerationId)
}

/** 仅隔离契约测试使用；生产代码不得动态替换 outbox consumer。 */
export function setConversationOutboxConsumerForIsolatedTest(
  consumer: OutboxEventConsumer | null
): void {
  if (
    process.env.CONVERSATION_COMMAND_API_AUTHORITY !== "isolated-test" ||
    process.env.NODE_ENV === "production"
  )
    throw new Error("只能在 isolated-test authority 下替换 outbox consumer")
  globalThis.__conversationOutboxConsumerOverride = consumer ?? undefined
  globalThis.__conversationCommandComposition = undefined
}

export function canonicalGenerationId(value: string) {
  return generationId(value)
}
