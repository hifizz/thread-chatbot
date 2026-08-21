import { randomUUID } from "node:crypto"

import type {
  ConversationOutboxDispatcher,
  OutboxEventConsumer,
} from "../application/conversation-command-service"
import { ConversationCommandApplicationService } from "../application/conversation-command-service"
import { generationId, type GenerationId } from "../domain/conversation-model"
import { InMemoryGenerationAbortRegistry } from "../generation/canonical-generation-execution"
import { CanonicalGenerationApplicationService } from "../generation/canonical-generation-execution"
import { CanonicalAiGenerationExecutor } from "../generation/canonical-ai-generation-executor"
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

function createComposition() {
  const policy = resolveConversationCommandApiPolicy()
  const store = new DrizzleConversationCommandStore(policy)
  const generations = new DrizzleConversationGenerationRepository({
    authority: policy.authority,
    legacyAuthorityEnabled:
      process.env.BRANCH_GENERATION_AUTHORITY_ENABLED !== "false",
  })
  const abortRegistry = new InMemoryGenerationAbortRegistry()
  const execution = new CanonicalGenerationApplicationService(
    generations,
    new CanonicalAiGenerationExecutor(store),
    abortRegistry
  )
  const defaultConsumer: OutboxEventConsumer = {
    async consume(event) {
      if (event.type !== "GenerationRequested") return
      const payload = event.payload as {
        generationId?: unknown
        ownerId?: unknown
        leaseOwner?: unknown
      }
      if (
        typeof payload.generationId !== "string" ||
        typeof payload.ownerId !== "string" ||
        typeof payload.leaseOwner !== "string"
      )
        throw new Error("GenerationRequested payload 无效")
      const generation = await generations.getGeneration({
        ownerId: payload.ownerId,
        generationId: generationId(payload.generationId),
      })
      if (!generation)
        throw new Error("GenerationRequested 指向不存在的 Generation")
      await execution.executeExisting(generation, payload.leaseOwner)
    },
  }
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
