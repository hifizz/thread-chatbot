import assert from "node:assert/strict"

assert.ok(process.env.DATABASE_URL, "测试需要隔离的 DATABASE_URL")
assert.ok(
  process.env.BETA_INVITE_ENCRYPTION_KEY,
  "测试需要 BETA_INVITE_ENCRYPTION_KEY"
)
process.env.BETTER_AUTH_URL ??= "http://localhost:4040"

const [{ eq, inArray }, { db }, schema, waitlist, invites, emailEvents, cryptoModule, pricing] =
  await Promise.all([
    import("drizzle-orm"),
    import("../../lib/db/index.ts"),
    import("../../lib/db/schema.ts"),
    import("../../lib/beta/waitlist.ts"),
    import("../../lib/beta/invites.ts"),
    import("../../lib/beta/email-events.ts"),
    import("../../lib/beta/crypto.ts"),
    import("../../constants/pricing.ts"),
  ])

const prefix = `beta-${crypto.randomUUID()}`
const adminId = `${prefix}-admin`
const userId = `${prefix}-user`
const invitedEmail = `${prefix}@example.test`

try {
  await db.insert(schema.user).values([
    {
      id: adminId,
      name: "Beta Admin",
      email: `${prefix}-admin@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: userId,
      name: "Beta User",
      email: invitedEmail,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ])

  await Promise.all([
    waitlist.joinBetaWaitlist({ email: `  ${invitedEmail.toUpperCase()} `, locale: "en" }),
    waitlist.joinBetaWaitlist({ email: invitedEmail, locale: "zh-CN" }),
  ])
  const entries = await db
    .select()
    .from(schema.betaWaitlistEntries)
    .where(eq(schema.betaWaitlistEntries.emailNormalized, invitedEmail))
  assert.equal(entries.length, 1, "重复申请必须归一化并去重")

  const approved = await invites.approveBetaWaitlist({
    waitlistId: entries[0].id,
    actorId: adminId,
    reason: "foundation test",
    requestId: crypto.randomUUID(),
  })
  const [outbox] = await db
    .select()
    .from(schema.betaEmailOutbox)
    .where(eq(schema.betaEmailOutbox.id, approved.outboxId))
  assert.ok(outbox.encryptedPayload)
  assert.equal(outbox.encryptedPayload.includes(invitedEmail), false)
  const payload = cryptoModule.decryptInvitePayload(outbox.encryptedPayload)
  assert.equal(payload.email, invitedEmail)
  assert.equal(payload.token.length >= 40, true)

  const [storedInvite] = await db
    .select()
    .from(schema.betaInvites)
    .where(eq(schema.betaInvites.id, approved.inviteId))
  assert.notEqual(storedInvite.tokenHash, payload.token)
  assert.equal(storedInvite.tokenHash, cryptoModule.hashInviteToken(payload.token))

  const providerMessageId = `email-${crypto.randomUUID()}`
  await db
    .update(schema.betaEmailOutbox)
    .set({ providerMessageId, status: "sent" })
    .where(eq(schema.betaEmailOutbox.id, approved.outboxId))
  const deliveredEvent = {
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: {
      created_at: new Date().toISOString(),
      email_id: providerMessageId,
      from: "noreply@example.test",
      to: [invitedEmail],
      subject: "Beta invite",
    },
  }
  const webhookEventId = crypto.randomUUID()
  assert.deepEqual(
    await emailEvents.recordBetaEmailEvent({
      eventId: webhookEventId,
      event: deliveredEvent,
    }),
    { accepted: true, replayed: false }
  )
  assert.deepEqual(
    await emailEvents.recordBetaEmailEvent({
      eventId: webhookEventId,
      event: deliveredEvent,
    }),
    { accepted: true, replayed: true }
  )
  await emailEvents.recordBetaEmailEvent({
    eventId: crypto.randomUUID(),
    event: { ...deliveredEvent, type: "email.sent" },
  })
  const [delivery] = await db
    .select({ status: schema.betaEmailOutbox.status })
    .from(schema.betaEmailOutbox)
    .where(eq(schema.betaEmailOutbox.id, approved.outboxId))
  assert.equal(delivery.status, "delivered", "乱序 sent 事件不能回退 delivered")

  await assert.rejects(
    invites.redeemBetaInvite({
      token: payload.token,
      userId,
      email: `other-${invitedEmail}`,
      emailVerified: true,
      requestId: crypto.randomUUID(),
    }),
    (error) => error?.code === "INVITE_EMAIL_MISMATCH"
  )

  const raced = await Promise.all([
    invites.redeemBetaInvite({
      token: payload.token,
      userId,
      email: invitedEmail,
      emailVerified: true,
      requestId: crypto.randomUUID(),
    }),
    invites.redeemBetaInvite({
      token: payload.token,
      userId,
      email: invitedEmail,
      emailVerified: true,
      requestId: crypto.randomUUID(),
    }),
  ])
  assert.equal(raced.filter((result) => result.replayed === false).length, 1)
  assert.equal(raced.filter((result) => result.replayed === true).length, 1)

  const [entitlement] = await db
    .select()
    .from(schema.userEntitlements)
    .where(eq(schema.userEntitlements.userId, userId))
  assert.equal(entitlement.plan, "beta")
  assert.equal(entitlement.accountStatus, "active")

  const [credits] = await db
    .select()
    .from(schema.userCredits)
    .where(eq(schema.userCredits.userId, userId))
  assert.equal(credits.balanceMicros, pricing.INITIAL_CREDIT_MICROS)
  const ledger = await db
    .select()
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, userId))
  assert.equal(
    ledger.filter((entry) => entry.idempotencyKey === `beta-welcome-v1:${userId}`).length,
    1,
    "并发核销只能发放一次欢迎额度"
  )

  console.log("PASS  beta invite hashing, email matching, atomic redemption, and grant idempotency")
} finally {
  await db
    .delete(schema.adminAuditLogs)
    .where(inArray(schema.adminAuditLogs.actorId, [userId, adminId]))
  await db
    .delete(schema.betaWaitlistEntries)
    .where(eq(schema.betaWaitlistEntries.emailNormalized, invitedEmail))
  await db.delete(schema.user).where(eq(schema.user.id, userId))
  await db.delete(schema.user).where(eq(schema.user.id, adminId))
}
