import { and, eq, inArray, sql } from "drizzle-orm"
import type {
  GenerationBillingStatus,
  GenerationResultV1,
} from "@/lib/thread-chat/domain/generation"
import { ACTIVE_GENERATION_STATUSES } from "@/constants/generation"
import {
  chargeUsageOnce,
  type BillingTransaction,
  type UsageCostEvidence,
} from "@/lib/billing/credits"
import { db } from "@/lib/db"
import { branchGenerations } from "@/lib/db/schema"

export type FinalizeGenerationUsage = {
  inputTokens: number
  outputTokens: number
  costEvidence?: UsageCostEvidence
}

export type FinalizeGenerationInput = {
  generationId: string
  outcome: "completed" | "stopped" | "failed"
  result: GenerationResultV1
  error?: string
  usage?: FinalizeGenerationUsage
  usageUnavailable?: boolean
}

type GenerationBillingIdentity = {
  id: string
  userId: string
  modelId: string
  threadId: string
  assistantMessageId: string
}

async function settleGenerationUsage(
  tx: BillingTransaction,
  generation: GenerationBillingIdentity,
  usage: FinalizeGenerationUsage
) {
  await chargeUsageOnce(tx, generation.id, {
    userId: generation.userId,
    model: generation.modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    threadId: generation.threadId,
    messageId: generation.assistantMessageId,
    costEvidence: usage.costEvidence,
  })
}

export async function finalizeGeneration(input: FinalizeGenerationInput) {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select ${branchGenerations.id}
      from ${branchGenerations}
      where ${branchGenerations.id} = ${input.generationId}
      for update
    `)
    if (locked.length === 0) return null

    const [row] = await tx
      .select()
      .from(branchGenerations)
      .where(eq(branchGenerations.id, input.generationId))
    if (!row) return null

    // 终态不可逆；迟到的权威 usage 仍需补记账，但不得改写用户已看到的结果。
    if (["completed", "stopped", "failed"].includes(row.status)) {
      if (!input.usage || row.billingStatus === "settled") return row
      await settleGenerationUsage(tx, row, input.usage)
      const [updated] = await tx
        .update(branchGenerations)
        .set({ billingStatus: "settled", updatedAt: new Date() })
        .where(eq(branchGenerations.id, input.generationId))
        .returning()
      return updated ?? row
    }

    let terminalStatus = input.outcome
    if (row.status === "superseded" || !row.isCurrent) {
      terminalStatus = "failed"
    } else if (row.status === "stop_requested") {
      terminalStatus = "stopped"
    }

    let billingStatus: GenerationBillingStatus = "not_billable"
    if (input.usage) {
      await settleGenerationUsage(tx, row, input.usage)
      billingStatus = "settled"
    } else if (input.usageUnavailable) {
      billingStatus = "usage_unavailable"
    }

    const now = new Date()
    if (row.status === "superseded" || !row.isCurrent) {
      const [updated] = await tx
        .update(branchGenerations)
        .set({
          result: input.result,
          error: input.error ?? null,
          billingStatus,
          finishedAt: row.finishedAt ?? now,
          updatedAt: now,
        })
        .where(eq(branchGenerations.id, input.generationId))
        .returning()
      return updated ?? row
    }

    const [updated] = await tx
      .update(branchGenerations)
      .set({
        status: terminalStatus,
        result: input.result,
        error: input.error ?? null,
        billingStatus,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(branchGenerations.id, input.generationId),
          inArray(branchGenerations.status, ACTIVE_GENERATION_STATUSES)
        )
      )
      .returning()
    return updated ?? row
  })
}
