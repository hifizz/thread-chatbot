import { randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import {
  BILLING_MAX_ACTIVE_RESERVATIONS,
  BILLING_POLICY_VERSION,
  BILLING_RESERVATION_TTL_MS,
  BILLING_RESERVED_INPUT_TOKENS,
} from "@/constants/billing"
import { getChatModel } from "@/constants/model"
import {
  MICROS_PER_YUAN,
  ModelPricingUnavailableError,
  PROFIT_MARGIN,
  USD_TO_CNY,
  priceFromCost,
  requireModelCost,
  toMicros,
} from "@/constants/pricing"
import { BillingAdmissionError } from "@/lib/billing/errors"
import { appendLedgerEntryOnce } from "@/lib/billing/ledger"
import type { BillingTransaction } from "@/lib/billing/credits"
import { db } from "@/lib/db"
import {
  billingPriceSnapshots,
  billingReservations,
  billingUsageLines,
  usageRecords,
  userCredits,
} from "@/lib/db/schema"

type ReserveGenerationInput = {
  userId: string
  generationId: string
  modelId: string
  maxOutputTokens: number
}

export type ReservationResult = {
  reservationId: string
  customerReservedMicros: number
  expiresAt: Date
}

function safeTokenLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError("生成 Token 上限必须是正安全整数")
  return value
}

function snapshotRates(modelId: string) {
  const cost = requireModelCost(modelId)
  return {
    cost,
    rates: [
      {
        unit: "uncached_input_token",
        decimalPrice: String(cost.inputPerMillion),
        perUnits: 1_000_000,
      },
      {
        unit: "output_token",
        decimalPrice: String(cost.outputPerMillion),
        perUnits: 1_000_000,
      },
      // 未配置供应商专属缓存价格时按普通输入价保守冻结；价格表补齐后只影响新任务。
      {
        unit: "cached_input_token",
        decimalPrice: String(cost.inputPerMillion),
        perUnits: 1_000_000,
      },
      {
        unit: "cache_write_token",
        decimalPrice: String(cost.inputPerMillion),
        perUnits: 1_000_000,
      },
    ],
  }
}

/** 在创建生成消息的同一短事务内调用；账户行锁让多个应用实例共享同一余额边界。 */
export async function reserveGenerationInTransaction(
  tx: BillingTransaction,
  input: ReserveGenerationInput
): Promise<ReservationResult> {
  const existing = await tx
    .select({
      id: billingReservations.id,
      customerReservedMicros: billingReservations.customerReservedMicros,
      expiresAt: billingReservations.expiresAt,
    })
    .from(billingReservations)
    .where(eq(billingReservations.generationId, input.generationId))
    .limit(1)
  if (existing[0]) {
    return {
      reservationId: existing[0].id,
      customerReservedMicros: existing[0].customerReservedMicros,
      expiresAt: existing[0].expiresAt,
    }
  }

  const model = getChatModel(input.modelId)
  if (!model)
    throw new BillingAdmissionError(
      "MODEL_PRICING_UNAVAILABLE",
      "模型没有可用定价"
    )
  let frozen: ReturnType<typeof snapshotRates>
  try {
    frozen = snapshotRates(input.modelId)
  } catch (error) {
    if (error instanceof ModelPricingUnavailableError)
      throw new BillingAdmissionError(
        "MODEL_PRICING_UNAVAILABLE",
        "模型尚未配置有效价格"
      )
    throw error
  }

  const maxOutputTokens = safeTokenLimit(input.maxOutputTokens)
  const nativeCost =
    (BILLING_RESERVED_INPUT_TOKENS * frozen.cost.inputPerMillion +
      maxOutputTokens * frozen.cost.outputPerMillion) /
    1_000_000
  const supplierReservedMicros = Math.ceil(
    toMicros(nativeCost, frozen.cost.currency)
  )
  const customerReservedMicros = priceFromCost(supplierReservedMicros)
  if (
    !Number.isSafeInteger(supplierReservedMicros) ||
    !Number.isSafeInteger(customerReservedMicros)
  )
    throw new RangeError("预占金额超出安全整数范围")

  const [account] = await tx
    .select({ balanceMicros: userCredits.balanceMicros })
    .from(userCredits)
    .where(eq(userCredits.userId, input.userId))
    .for("update")
  if (!account || account.balanceMicros <= 0)
    throw new BillingAdmissionError("CREDIT_EXHAUSTED", "体验额度已用完")

  const [held] = await tx
    .select({
      amount: sql<number>`coalesce(sum(${billingReservations.customerReservedMicros}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(billingReservations)
    .where(
      and(
        eq(billingReservations.userId, input.userId),
        inArray(billingReservations.status, [
          "held",
          "reconciliation_required",
        ])
      )
    )
  const activeCount = Number(held?.count ?? 0)
  if (activeCount >= BILLING_MAX_ACTIVE_RESERVATIONS)
    throw new BillingAdmissionError(
      "TOO_MANY_ACTIVE_RUNS",
      "同时运行的任务过多，请等待已有任务完成"
    )
  const availableMicros = account.balanceMicros - Number(held?.amount ?? 0)
  if (availableMicros < customerReservedMicros)
    throw new BillingAdmissionError(
      "RUN_RESERVATION_INSUFFICIENT",
      "剩余额度不足以完成当前设置的任务"
    )

  const now = new Date()
  const expiresAt = new Date(now.getTime() + BILLING_RESERVATION_TTL_MS)
  const snapshotId = randomUUID()
  await tx.insert(billingPriceSnapshots).values({
    id: snapshotId,
    generationId: input.generationId,
    providerId: model.provider,
    serviceId: input.modelId,
    currency: frozen.cost.currency,
    rates: frozen.rates,
    fxToCny: String(USD_TO_CNY),
    chargingPolicyVersion: BILLING_POLICY_VERSION,
    effectiveAt: now,
  })
  const reservationId = randomUUID()
  await tx.insert(billingReservations).values({
    id: reservationId,
    generationId: input.generationId,
    userId: input.userId,
    priceSnapshotId: snapshotId,
    customerReservedMicros,
    supplierReservedMicros,
    expiresAt,
  })
  return { reservationId, customerReservedMicros, expiresAt }
}

export function reserveGeneration(input: ReserveGenerationInput) {
  return db.transaction((tx) => reserveGenerationInTransaction(tx, input))
}

function usageNumber(
  usage: Record<string, unknown> | undefined,
  key: "inputTokens" | "outputTokens"
): number | null {
  const value = usage?.[key]
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function usageInputBreakdown(
  usage: Record<string, unknown>,
  fallbackInputTokens: number
): {
  uncachedInputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
} {
  const details = usage.inputTokenDetails
  if (typeof details !== "object" || details === null)
    return {
      uncachedInputTokens: fallbackInputTokens,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    }
  const record = details as Record<string, unknown>
  const values = [
    record.noCacheTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens,
  ]
  if (
    values.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
    )
  ) {
    return {
      uncachedInputTokens: fallbackInputTokens,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    }
  }
  return {
    uncachedInputTokens: values[0] as number,
    cachedInputTokens: values[1] as number,
    cacheWriteTokens: values[2] as number,
  }
}

function allocateMicros(total: number, weights: readonly number[]): number[] {
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  if (weightTotal === 0) return weights.map(() => 0)
  let allocated = 0
  return weights.map((weight, index) => {
    const value =
      index === weights.length - 1
        ? total - allocated
        : Math.floor((total * weight) / weightTotal)
    allocated += value
    return value
  })
}

function costFromFrozenRate(input: {
  quantity: number
  decimalPrice: string
  perUnits: number
  currency: "CNY" | "USD"
  fxToCny: string
}): number {
  const native =
    (input.quantity * Number(input.decimalPrice)) / input.perUnits
  const yuan = input.currency === "USD" ? native * Number(input.fxToCny) : native
  const result = Math.ceil(yuan * MICROS_PER_YUAN)
  if (!Number.isSafeInteger(result))
    throw new RangeError("结算金额超出安全整数范围")
  return result
}

export type SettlementResult = {
  status: "settled" | "released" | "reconciliation_required"
  chargedMicros: number
  providerCostMicros: number | null
}

/** 终态事务内幂等结算；没有可靠 usage 时保留证据并进入人工对账。 */
export async function settleGenerationInTransaction(
  tx: BillingTransaction,
  input: {
    generationId: string
    userId: string
    threadId?: string | null
    messageId?: string | null
    modelId: string
    providerUsage?: Record<string, unknown>
    providerCostMicros?: number
    costSource?: "estimate" | "gateway" | "openrouter"
  }
): Promise<SettlementResult | null> {
  const [reservation] = await tx
    .select({
      id: billingReservations.id,
      status: billingReservations.status,
      userId: billingReservations.userId,
      customerReservedMicros: billingReservations.customerReservedMicros,
      snapshotId: billingPriceSnapshots.id,
      serviceId: billingPriceSnapshots.serviceId,
      currency: billingPriceSnapshots.currency,
      rates: billingPriceSnapshots.rates,
      fxToCny: billingPriceSnapshots.fxToCny,
    })
    .from(billingReservations)
    .innerJoin(
      billingPriceSnapshots,
      eq(billingPriceSnapshots.id, billingReservations.priceSnapshotId)
    )
    .where(eq(billingReservations.generationId, input.generationId))
    .for("update")
  if (!reservation) return null
  if (reservation.userId !== input.userId) throw new Error("BILLING_OWNER_MISMATCH")
  if (reservation.status !== "held") {
    return {
      status: reservation.status,
      chargedMicros: 0,
      providerCostMicros: null,
    }
  }

  const inputTokens = usageNumber(input.providerUsage, "inputTokens")
  const outputTokens = usageNumber(input.providerUsage, "outputTokens")
  if (inputTokens === null || outputTokens === null) {
    await tx
      .update(billingReservations)
      .set({ status: "reconciliation_required", updatedAt: new Date() })
      .where(eq(billingReservations.id, reservation.id))
    return {
      status: "reconciliation_required",
      chargedMicros: 0,
      providerCostMicros: null,
    }
  }

  if (input.modelId !== reservation.serviceId)
    throw new Error("BILLING_MODEL_MISMATCH")
  const inputBreakdown = usageInputBreakdown(
    input.providerUsage!,
    inputTokens
  )
  const quantities = [
    {
      unit: "uncached_input_token" as const,
      quantity: inputBreakdown.uncachedInputTokens,
    },
    {
      unit: "cached_input_token" as const,
      quantity: inputBreakdown.cachedInputTokens,
    },
    {
      unit: "cache_write_token" as const,
      quantity: inputBreakdown.cacheWriteTokens,
    },
    { unit: "output_token" as const, quantity: outputTokens },
  ]
  const estimatedCosts = quantities.map(({ unit, quantity }) => {
    const rate = reservation.rates.find((item) => item.unit === unit)
    if (!rate) throw new Error("BILLING_SNAPSHOT_INVALID")
    return costFromFrozenRate({
      quantity,
      ...rate,
      currency: reservation.currency,
      fxToCny: reservation.fxToCny,
    })
  })
  const estimatedProviderCostMicros = estimatedCosts.reduce(
    (sum, value) => sum + value,
    0
  )
  const providerCostMicros =
    input.providerCostMicros ?? estimatedProviderCostMicros
  if (!Number.isSafeInteger(providerCostMicros) || providerCostMicros < 0)
    throw new RangeError("供应商成本必须是非负安全整数")
  const calculatedCharge = Math.ceil(providerCostMicros / (1 - PROFIT_MARGIN))
  const chargedMicros = Math.min(
    calculatedCharge,
    reservation.customerReservedMicros
  )
  const attemptId = input.generationId
  const providerCostAllocation = allocateMicros(
    providerCostMicros,
    estimatedCosts
  )
  const userChargeAllocation = allocateMicros(
    chargedMicros,
    providerCostAllocation
  )
  const evidence =
    input.costSource && input.costSource !== "estimate"
      ? ("reported" as const)
      : ("estimated" as const)

  await tx
    .insert(billingUsageLines)
    .values(
      quantities.map(({ unit, quantity }, index) => ({
        id: randomUUID(),
        generationId: input.generationId,
        operationId: input.generationId,
        attemptId,
        kind: "llm" as const,
        unit,
        quantity,
        providerCostMicros: providerCostAllocation[index],
        userChargeMicros: userChargeAllocation[index],
        evidence,
        pricingSnapshotId: reservation.snapshotId,
      }))
    )
    .onConflictDoNothing()

  await tx
    .insert(usageRecords)
    .values({
      id: randomUUID(),
      userId: input.userId,
      threadId: input.threadId ?? null,
      messageId: input.messageId ?? null,
      appGenerationId: input.generationId,
      model: reservation.serviceId,
      inputTokens,
      outputTokens,
      costMicros: providerCostMicros,
      priceMicros: chargedMicros,
      costSource: input.costSource ?? "estimate",
    })
    .onConflictDoNothing({ target: usageRecords.appGenerationId })

  await appendLedgerEntryOnce(tx, {
    userId: input.userId,
    kind: "charge",
    amountMicros: -chargedMicros,
    idempotencyKey: `generation-charge-v1:${input.generationId}`,
    referenceId: input.generationId,
    reason: `生成结算 ${input.modelId}`,
  })
  const now = new Date()
  // 超出预占是平台估算责任：供应商成本完整记录，用户扣额不超过已确认上限。
  const status = "settled" as const
  await tx
    .update(billingReservations)
    .set({
      status,
      customerChargedMicros: chargedMicros,
      supplierCostMicros: providerCostMicros,
      settledAt: now,
      updatedAt: now,
    })
    .where(eq(billingReservations.id, reservation.id))
  return { status, chargedMicros, providerCostMicros }
}

export function settleGeneration(
  input: Parameters<typeof settleGenerationInTransaction>[1]
) {
  return db.transaction((tx) => settleGenerationInTransaction(tx, input))
}

/** 仅用于确认尚未调用任何付费供应商的初始化失败。 */
export async function releaseUnusedReservation(input: {
  generationId: string
  userId: string
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [reservation] = await tx
      .select({
        id: billingReservations.id,
        userId: billingReservations.userId,
        status: billingReservations.status,
      })
      .from(billingReservations)
      .where(eq(billingReservations.generationId, input.generationId))
      .for("update")
    if (
      !reservation ||
      reservation.userId !== input.userId ||
      reservation.status !== "held"
    )
      return false
    const now = new Date()
    await tx
      .update(billingReservations)
      .set({ status: "released", settledAt: now, updatedAt: now })
      .where(eq(billingReservations.id, reservation.id))
    return true
  })
}
