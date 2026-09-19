import assert from "node:assert/strict"

const databaseUrl = process.env.DATABASE_URL
assert.ok(databaseUrl, "测试需要隔离的 DATABASE_URL")

const [{ eq }, { db }, schema, billing, pricing] = await Promise.all([
  import("drizzle-orm"),
  import("../../lib/db/index.ts"),
  import("../../lib/db/schema.ts"),
  import("../../lib/billing/reservations.ts"),
  import("../../constants/pricing.ts"),
])

const prefix = `billing-${crypto.randomUUID()}`
const userId = `${prefix}-user`
const modelId = "openrouter-gpt-5.6-luna"
const generationA = crypto.randomUUID()
const generationB = crypto.randomUUID()

try {
  await db.insert(schema.user).values({
    id: userId,
    name: "Billing Test",
    email: `${prefix}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(schema.userCredits).values({
    userId,
    balanceMicros: 1,
  })

  // 先在回滚事务外无法探测预占额，因此按同一冻结公式设置只够一轮的余额。
  const modelCost = pricing.requireModelCost(modelId)
  const nativeCost =
    (128_000 * modelCost.inputPerMillion +
      16_000 * modelCost.outputPerMillion) /
    1_000_000
  const reservationMicros = pricing.priceFromCost(
    Math.ceil(pricing.toMicros(nativeCost, modelCost.currency))
  )
  await db
    .update(schema.userCredits)
    .set({ balanceMicros: reservationMicros })
    .where(eq(schema.userCredits.userId, userId))

  const raced = await Promise.allSettled([
    billing.reserveGeneration({
      userId,
      generationId: generationA,
      modelId,
      maxOutputTokens: 16_000,
    }),
    billing.reserveGeneration({
      userId,
      generationId: generationB,
      modelId,
      maxOutputTokens: 16_000,
    }),
  ])
  assert.equal(
    raced.filter((result) => result.status === "fulfilled").length,
    1,
    "两个实例争用最后余额时只能有一个预占成功"
  )
  const rejected = raced.find((result) => result.status === "rejected")
  assert.equal(rejected?.reason?.code, "RUN_RESERVATION_INSUFFICIENT")

  const successfulGeneration =
    raced[0].status === "fulfilled" ? generationA : generationB
  const firstSettlement = await billing.settleGeneration({
    generationId: successfulGeneration,
    userId,
    modelId,
    providerUsage: {
      inputTokens: 2_000,
      outputTokens: 1_000,
      inputTokenDetails: {
        noCacheTokens: 1_200,
        cacheReadTokens: 600,
        cacheWriteTokens: 200,
      },
    },
  })
  assert.equal(firstSettlement?.status, "settled")
  assert.ok((firstSettlement?.chargedMicros ?? 0) > 0)
  const repeatedSettlement = await billing.settleGeneration({
    generationId: successfulGeneration,
    userId,
    modelId,
    providerUsage: { inputTokens: 2_000, outputTokens: 1_000 },
  })
  assert.equal(repeatedSettlement?.status, "settled")
  assert.equal(repeatedSettlement?.chargedMicros, 0)

  const ledger = await db
    .select()
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.referenceId, successfulGeneration))
  assert.equal(ledger.length, 1, "重复结算只能产生一条扣款流水")
  const usageLines = await db
    .select()
    .from(schema.billingUsageLines)
    .where(eq(schema.billingUsageLines.generationId, successfulGeneration))
  assert.deepEqual(
    Object.fromEntries(usageLines.map((line) => [line.unit, line.quantity])),
    {
      uncached_input_token: 1_200,
      cached_input_token: 600,
      cache_write_token: 200,
      output_token: 1_000,
    },
    "缓存输入、缓存写入与普通输入必须互斥记录"
  )

  await assert.rejects(
    billing.reserveGeneration({
      userId,
      generationId: crypto.randomUUID(),
      modelId: "private-relay-gpt-5.6-luna",
      maxOutputTokens: 16_000,
    }),
    (error) => error?.code === "MODEL_PRICING_UNAVAILABLE"
  )

  console.log("PASS  billing reservation concurrency and settlement idempotency")
} finally {
  await db.delete(schema.user).where(eq(schema.user.id, userId))
  await globalThis.__dbClient?.end({ timeout: 5 })
}
