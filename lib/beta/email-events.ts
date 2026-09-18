import { and, eq, inArray } from "drizzle-orm"
import type { WebhookEventPayload } from "resend"
import { db } from "@/lib/db"
import { betaEmailEvents, betaEmailOutbox } from "@/lib/db/schema"

export async function recordBetaEmailEvent(input: {
  eventId: string
  event: WebhookEventPayload
}): Promise<{ accepted: boolean; replayed: boolean }> {
  const event = input.event
  if (!("email_id" in event.data))
    return { accepted: false, replayed: false }
  const providerMessageId = event.data.email_id

  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({ id: betaEmailOutbox.id })
      .from(betaEmailOutbox)
      .where(eq(betaEmailOutbox.providerMessageId, providerMessageId))
    if (!delivery) return { accepted: false, replayed: false }

    const [inserted] = await tx
      .insert(betaEmailEvents)
      .values({
        eventId: input.eventId,
        providerMessageId,
        type: event.type,
        payload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: betaEmailEvents.eventId })
      .returning({ eventId: betaEmailEvents.eventId })
    if (!inserted) return { accepted: true, replayed: true }

    if (event.type === "email.delivered") {
      await tx
        .update(betaEmailOutbox)
        .set({ status: "delivered", updatedAt: new Date() })
        .where(eq(betaEmailOutbox.providerMessageId, providerMessageId))
    } else if (event.type === "email.bounced") {
      await tx
        .update(betaEmailOutbox)
        .set({ status: "bounced", nextAttemptAt: null, updatedAt: new Date() })
        .where(eq(betaEmailOutbox.providerMessageId, providerMessageId))
    } else if (event.type === "email.complained") {
      await tx
        .update(betaEmailOutbox)
        .set({ status: "complained", nextAttemptAt: null, updatedAt: new Date() })
        .where(eq(betaEmailOutbox.providerMessageId, providerMessageId))
    } else if (
      event.type === "email.failed" ||
      event.type === "email.suppressed"
    ) {
      await tx
        .update(betaEmailOutbox)
        .set({ status: "failed", nextAttemptAt: null, updatedAt: new Date() })
        .where(eq(betaEmailOutbox.providerMessageId, providerMessageId))
    } else if (event.type === "email.sent") {
      await tx
        .update(betaEmailOutbox)
        .set({ status: "sent", updatedAt: new Date() })
        .where(
          and(
            inArray(betaEmailOutbox.status, ["queued", "sending", "sent"]),
            eq(betaEmailOutbox.providerMessageId, providerMessageId)
          )
        )
    }
    return { accepted: true, replayed: false }
  })
}
