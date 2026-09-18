import { eq } from "drizzle-orm"
import { BETA_ACCESS_ENFORCED, BETA_MODEL_IDS } from "@/constants/beta-access"
import { db } from "@/lib/db"
import { userEntitlements } from "@/lib/db/schema"

export type EntitlementDenialCode =
  | "BETA_ACCESS_REQUIRED"
  | "ACCOUNT_SUSPENDED"
  | "MODEL_NOT_ALLOWED"

export type EntitlementDecision =
  | { allowed: true; userId: string; modelId: string | null }
  | { allowed: false; code: EntitlementDenialCode }

export async function decideBetaAccess(
  userId: string,
  modelId?: string
): Promise<EntitlementDecision> {
  if (!BETA_ACCESS_ENFORCED)
    return { allowed: true, userId, modelId: modelId ?? null }

  const [entitlement] = await db
    .select({
      plan: userEntitlements.plan,
      accountStatus: userEntitlements.accountStatus,
      planExpiresAt: userEntitlements.planExpiresAt,
    })
    .from(userEntitlements)
    .where(eq(userEntitlements.userId, userId))

  if (!entitlement) return { allowed: false, code: "BETA_ACCESS_REQUIRED" }
  if (entitlement.accountStatus === "suspended")
    return { allowed: false, code: "ACCOUNT_SUSPENDED" }

  const proActive =
    entitlement.plan === "pro" &&
    (!entitlement.planExpiresAt || entitlement.planExpiresAt > new Date())
  if (modelId && !proActive && !BETA_MODEL_IDS.has(modelId))
    return { allowed: false, code: "MODEL_NOT_ALLOWED" }
  return { allowed: true, userId, modelId: modelId ?? null }
}

export async function requireBetaAccess(
  userId: string,
  modelId?: string
): Promise<void> {
  const decision = await decideBetaAccess(userId, modelId)
  if (!decision.allowed) throw new BetaAccessError(decision.code)
}

export class BetaAccessError extends Error {
  constructor(readonly code: EntitlementDenialCode) {
    super(
      code === "ACCOUNT_SUSPENDED"
        ? "账号已暂停"
        : code === "MODEL_NOT_ALLOWED"
          ? "当前权益不可使用该模型"
          : "Beta 权限尚未激活"
    )
    this.name = "BetaAccessError"
  }
}
