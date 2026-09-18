import { createHash, randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
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
