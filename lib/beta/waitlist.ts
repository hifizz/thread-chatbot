import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { betaWaitlistEntries } from "@/lib/db/schema"

export type BetaLocale = "zh-CN" | "en"

export function normalizeWaitlistEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function joinBetaWaitlist(input: {
  email: string
  locale: BetaLocale
}): Promise<void> {
  const emailNormalized = normalizeWaitlistEmail(input.email)
  await db
    .insert(betaWaitlistEntries)
    .values({
      id: randomUUID(),
      emailNormalized,
      locale: input.locale,
    })
    .onConflictDoUpdate({
      target: betaWaitlistEntries.emailNormalized,
      set: { locale: input.locale, updatedAt: new Date() },
      setWhere: eq(betaWaitlistEntries.status, "pending"),
    })
}
