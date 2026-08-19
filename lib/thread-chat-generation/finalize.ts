import { and, eq, inArray, sql } from "drizzle-orm"
import type {
  GenerationBillingStatus,
  GenerationResultV1,
} from "@/lib/thread-chat/domain/generation"
import { ACTIVE_GENERATION_STATUSES } from "@/constants/generation"
import { chargeUsageOnce, type UsageCostEvidence } from "@/lib/billing/credits"
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

    // 已经由另一回调收口：直接返回，usage 唯一键也会提供第二层保护。
    if (["completed", "stopped", "failed"].includes(row.status)) return row

    let terminalStatus = input.outcome
    if (row.status === "superseded" || !row.isCurrent) {
      terminalStatus = "failed"
    } else if (row.status === "stop_requested") {
      terminalStatus = "stopped"
    }

    let billingStatus: GenerationBillingStatus = "not_billable"
    if (input.usage) {
      await chargeUsageOnce(tx, input.generationId, {
        userId: row.userId,
        model: row.modelId,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        threadId: row.threadId,
        messageId: row.assistantMessageId,
        costEvidence: input.usage.costEvidence,
      })
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
