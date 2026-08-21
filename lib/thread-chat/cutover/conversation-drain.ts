export interface ConversationDrainCounts {
  readonly legacyActiveGenerations: number
  readonly legacyPendingBilling: number
  readonly canonicalActiveGenerations: number
  readonly canonicalPendingBilling: number
  readonly canonicalPendingOutbox: number
}

export type ConversationDrainBlockerCode =
  | "legacy_generation_active"
  | "legacy_billing_pending"
  | "canonical_generation_active"
  | "canonical_billing_pending"
  | "canonical_outbox_pending"

export interface ConversationDrainReport {
  readonly ready: boolean
  readonly counts: ConversationDrainCounts
  readonly blockers: readonly {
    readonly code: ConversationDrainBlockerCode
    readonly count: number
  }[]
}

/**
 * Cutover 的纯门禁判定。任何非终态 Generation、未终结计费或未派发 outbox
 * 都代表系统仍可能产生新事实，因此不能切换 authority。
 */
export function evaluateConversationCutoverDrain(
  counts: ConversationDrainCounts
): ConversationDrainReport {
  const candidates: readonly [ConversationDrainBlockerCode, number][] = [
    ["legacy_generation_active", counts.legacyActiveGenerations],
    ["legacy_billing_pending", counts.legacyPendingBilling],
    ["canonical_generation_active", counts.canonicalActiveGenerations],
    ["canonical_billing_pending", counts.canonicalPendingBilling],
    ["canonical_outbox_pending", counts.canonicalPendingOutbox],
  ]
  const blockers = candidates
    .filter(([, count]) => count > 0)
    .map(([code, count]) => ({ code, count }))
  return { ready: blockers.length === 0, counts, blockers }
}
