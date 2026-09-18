import { createHash } from "node:crypto"
import { z } from "zod"
import {
  PRODUCT_EVENT_ENVIRONMENTS,
  PRODUCT_EVENT_NAMES,
  PRODUCT_EVENT_SCHEMA_VERSION,
  type ProductEventEnvironment,
  type ProductEventName,
  type ProductEventPayloads,
} from "@/constants/analytics"
import type { ObservabilityEnvironment } from "@/constants/observability"
import { isSafeAnalyticsEvent } from "@/lib/privacy/analytics-gate"

export type {
  ProductEventEnvironment,
  ProductEventName,
  ProductEventPayloads,
}

export type ProductEvent<K extends ProductEventName = ProductEventName> = {
  id: string
  name: K
  schemaVersion: typeof PRODUCT_EVENT_SCHEMA_VERSION
  occurredAt: string
  userId: string
  release: string
  environment: ProductEventEnvironment
  payload: ProductEventPayloads[K]
}

const uuidSchema = z.uuid()
const payloadSchemas: {
  [K in ProductEventName]: z.ZodType<ProductEventPayloads[K]>
} = {
  "generation.started": z.object({
    generationId: uuidSchema,
    modelId: z.string().min(1).max(120),
  }),
  "generation.completed": z.object({
    generationId: uuidSchema,
    durationMs: z.number().int().nonnegative().max(86_400_000),
  }),
  "generation.failed": z.object({
    generationId: uuidSchema,
    errorCode: z.string().min(1).max(120),
  }),
  "branch.created": z.object({
    threadId: uuidSchema,
    parentThreadId: uuidSchema,
  }),
  "artifact.updated": z.object({
    artifactId: z.string().min(1).max(200),
    revisionId: uuidSchema,
  }),
  "core_flow.completed": z.object({
    projectId: uuidSchema,
    threadId: uuidSchema,
  }),
  "credit.exhausted": z.object({
    generationId: uuidSchema.nullable(),
  }),
}

const productEventSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.enum(PRODUCT_EVENT_NAMES),
  schemaVersion: z.literal(PRODUCT_EVENT_SCHEMA_VERSION),
  occurredAt: z.iso.datetime({ offset: false }),
  userId: z.string().min(1).max(120),
  release: z.string().min(1).max(120),
  environment: z.enum(PRODUCT_EVENT_ENVIRONMENTS),
  payload: z.record(z.string(), z.unknown()),
})

/**
 * 去重 ID 由事实记录 ID 与版本决定；同一事实重复投递得到相同 ID，
 * PostHog 按 uuid 去重，不会因重试重复计数。
 */
export function stableProductEventId(input: {
  name: ProductEventName
  factId: string
  factVersion: number | string
}): string {
  return createHash("sha256")
    .update(
      `product-event:v${PRODUCT_EVENT_SCHEMA_VERSION}:${input.name}:${input.factId}:${input.factVersion}`
    )
    .digest("hex")
}

export function buildProductEvent<K extends ProductEventName>(input: {
  name: K
  factId: string
  factVersion?: number | string
  occurredAt?: Date
  userId: string
  release: string
  environment: ObservabilityEnvironment
  payload: ProductEventPayloads[K]
}): ProductEvent<K> {
  const environment = (
    PRODUCT_EVENT_ENVIRONMENTS as readonly string[]
  ).includes(input.environment)
    ? (input.environment as ProductEventEnvironment)
    : "development"
  return {
    id: stableProductEventId({
      name: input.name,
      factId: input.factId,
      factVersion: input.factVersion ?? 1,
    }),
    name: input.name,
    schemaVersion: PRODUCT_EVENT_SCHEMA_VERSION,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    userId: input.userId,
    release: input.release,
    environment,
    payload: input.payload,
  }
}

/** 白名单校验：schema、payload 形状与属性禁用词三重检查，失败返回 null。 */
export function parseProductEvent(value: unknown): ProductEvent | null {
  const base = productEventSchema.safeParse(value)
  if (!base.success) return null
  const event = base.data
  const payload = payloadSchemas[event.name].safeParse(event.payload)
  if (!payload.success) return null
  if (
    !isSafeAnalyticsEvent({
      name: event.name,
      properties: event.payload as Record<
        string,
        string | number | boolean | null
      >,
    })
  )
    return null
  return { ...event, payload: payload.data } as ProductEvent
}

export function validateProductEvent<K extends ProductEventName>(
  event: ProductEvent<K>
): ProductEvent<K> | null {
  const parsed = parseProductEvent(event)
  return parsed ? (parsed as ProductEvent<K>) : null
}
