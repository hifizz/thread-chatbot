import { createHash, randomUUID } from "node:crypto"
import { and, eq, gt } from "drizzle-orm"
import { db } from "@/lib/db"
import { privacyConsents } from "@/lib/db/schema"
import type { ConsentCookiePayload } from "./types"

function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex")
}

/** 账户同意按设备保存；匿名选择只保留在服务端签名 Cookie 中。 */
export async function saveAccountConsent(
  userId: string,
  payload: ConsentCookiePayload
): Promise<void> {
  const deviceIdHash = hashDeviceId(payload.deviceId)
  const values = {
    policyVersion: payload.policyVersion,
    decision: payload.decision,
    analytics: payload.analytics,
    revision: payload.revision,
    decidedAt: new Date(payload.decidedAt),
    expiresAt: new Date(payload.expiresAt),
    updatedAt: new Date(),
  }
  await db
    .insert(privacyConsents)
    .values({
      id: randomUUID(),
      userId,
      deviceIdHash,
      ...values,
    })
    .onConflictDoUpdate({
      target: [privacyConsents.userId, privacyConsents.deviceIdHash],
      set: values,
    })
}

/**
 * 账户级分析授权：任一设备存在未过期的 accepted 记录即有效。
 * 服务端事实事件在投递前调用它重查当前状态；用户全部撤回后返回 false。
 */
export async function hasAccountAnalyticsConsent(
  userId: string,
  now = new Date()
): Promise<boolean> {
  const [stored] = await db
    .select({ id: privacyConsents.id })
    .from(privacyConsents)
    .where(
      and(
        eq(privacyConsents.userId, userId),
        eq(privacyConsents.decision, "accepted"),
        eq(privacyConsents.analytics, true),
        gt(privacyConsents.expiresAt, now)
      )
    )
    .limit(1)
  return Boolean(stored)
}

export async function accountConsentMatchesDevice(
  userId: string,
  payload: ConsentCookiePayload
): Promise<boolean> {
  const [stored] = await db
    .select({
      policyVersion: privacyConsents.policyVersion,
      decision: privacyConsents.decision,
      analytics: privacyConsents.analytics,
      revision: privacyConsents.revision,
      expiresAt: privacyConsents.expiresAt,
    })
    .from(privacyConsents)
    .where(
      and(
        eq(privacyConsents.userId, userId),
        eq(privacyConsents.deviceIdHash, hashDeviceId(payload.deviceId))
      )
    )
    .limit(1)
  return Boolean(
    stored &&
      stored.policyVersion === payload.policyVersion &&
      stored.decision === payload.decision &&
      stored.analytics === payload.analytics &&
      stored.revision === payload.revision &&
      stored.expiresAt > new Date()
  )
}
