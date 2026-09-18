import { randomUUID } from "node:crypto"
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm"
import {
  BETA_EMAIL_MAX_ATTEMPTS,
  BETA_INVITE_TTL_MS,
} from "@/constants/beta-access"
import { grantWelcomeCreditsInTransaction } from "@/lib/billing/ledger"
import {
  createInviteToken,
  decryptInvitePayload,
  encryptInvitePayload,
  hashInviteToken,
} from "@/lib/beta/crypto"
import { BetaHttpError } from "@/lib/beta/http"
import { normalizeWaitlistEmail, type BetaLocale } from "@/lib/beta/waitlist"
import { db } from "@/lib/db"
import {
  adminAuditLogs,
  betaEmailOutbox,
  betaInvites,
  betaWaitlistEntries,
  user,
  userEntitlements,
} from "@/lib/db/schema"
import { sendEmail } from "@/lib/email/client"
import { betaInviteEmail } from "@/lib/email/templates"

type InvitePayload = {
  email: string
  locale: BetaLocale
  token: string
  expiresAt: string
}

function inviteUrl(token: string): string {
  const baseUrl = process.env.BETTER_AUTH_URL?.trim()
  if (!baseUrl) throw new Error("BETTER_AUTH_URL_NOT_CONFIGURED")
  const url = new URL("/beta/invite", baseUrl)
  url.searchParams.set("token", token)
  return url.toString()
}

export async function approveBetaWaitlist(input: {
  waitlistId: string
  actorId: string
  reason: string
  requestId: string
}): Promise<{ inviteId: string; outboxId: string }> {
  const reason = input.reason.trim()
  if (!reason) throw new BetaHttpError("REASON_REQUIRED", "请填写审核原因", 400)

  const token = createInviteToken()
  const tokenHash = hashInviteToken(token)
  const inviteId = randomUUID()
  const outboxId = randomUUID()
  const expiresAt = new Date(Date.now() + BETA_INVITE_TTL_MS)

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(betaWaitlistEntries)
      .where(eq(betaWaitlistEntries.id, input.waitlistId))
      .for("update")
    if (!entry) throw new BetaHttpError("WAITLIST_NOT_FOUND", "申请不存在", 404)
    if (["registered", "rejected", "withdrawn"].includes(entry.status))
      throw new BetaHttpError("WAITLIST_STATE_CONFLICT", "当前状态不可批准", 409)

    const revoked = await tx
      .update(betaInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(betaInvites.waitlistId, entry.id),
          isNull(betaInvites.usedAt),
          isNull(betaInvites.revokedAt)
        )
      )
      .returning({ id: betaInvites.id })
    if (revoked.length > 0)
      await tx
        .update(betaEmailOutbox)
        .set({
          encryptedPayload: null,
          status: "failed",
          nextAttemptAt: null,
          lastError: "InviteRotated",
          updatedAt: new Date(),
        })
        .where(
          inArray(
            betaEmailOutbox.inviteId,
            revoked.map((item) => item.id)
          )
        )

    const encryptedPayload = encryptInvitePayload({
      email: entry.emailNormalized,
      locale: entry.locale,
      token,
      expiresAt: expiresAt.toISOString(),
    } satisfies InvitePayload)
    await tx.insert(betaInvites).values({
      id: inviteId,
      waitlistId: entry.id,
      tokenHash,
      expiresAt,
      createdBy: input.actorId,
    })
    await tx.insert(betaEmailOutbox).values({
      id: outboxId,
      inviteId,
      encryptedPayload,
    })
    await tx
      .update(betaWaitlistEntries)
      .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(betaWaitlistEntries.id, entry.id))
    await tx.insert(adminAuditLogs).values({
      id: randomUUID(),
      actorId: input.actorId,
      action: "beta.waitlist.approve",
      targetType: "beta_waitlist",
      targetId: entry.id,
      reason,
      requestId: input.requestId,
      metadata: { inviteId },
    })
    return { inviteId, outboxId }
  })
}

export async function deliverBetaInvite(outboxId: string): Promise<void> {
  const [claimed] = await db
    .update(betaEmailOutbox)
    .set({
      status: "sending",
      attempts: sql`${betaEmailOutbox.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(betaEmailOutbox.id, outboxId),
        inArray(betaEmailOutbox.status, ["queued", "failed"]),
        lt(betaEmailOutbox.attempts, BETA_EMAIL_MAX_ATTEMPTS)
      )
    )
    .returning({
      encryptedPayload: betaEmailOutbox.encryptedPayload,
      attempts: betaEmailOutbox.attempts,
    })
  if (!claimed?.encryptedPayload)
    throw new BetaHttpError("OUTBOX_NOT_AVAILABLE", "邀请邮件不可发送", 409)

  try {
    const payload = decryptInvitePayload<InvitePayload>(claimed.encryptedPayload)
    const message = betaInviteEmail(inviteUrl(payload.token), payload.locale)
    const providerMessageId = await sendEmail({
      to: payload.email,
      subject: message.subject,
      html: message.html,
      idempotencyKey: `beta-invite:${outboxId}`,
    })
    await db
      .update(betaEmailOutbox)
      .set({
        status: "sent",
        providerMessageId,
        encryptedPayload: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(betaEmailOutbox.id, outboxId))
  } catch (error) {
    await db
      .update(betaEmailOutbox)
      .set({
        status: "failed",
        lastError: error instanceof Error ? error.name : "UnknownError",
        nextAttemptAt:
          claimed.attempts < BETA_EMAIL_MAX_ATTEMPTS
            ? new Date(Date.now() + 30_000 * 2 ** (claimed.attempts - 1))
            : null,
        updatedAt: new Date(),
      })
      .where(eq(betaEmailOutbox.id, outboxId))
    throw new BetaHttpError("EMAIL_DELIVERY_FAILED", "邀请已批准，但邮件发送失败", 503)
  }
}

export async function redeemBetaInvite(input: {
  token: string
  userId: string
  email: string
  emailVerified: boolean
  requestId: string
}): Promise<{ activated: true; replayed: boolean }> {
  if (!input.emailVerified)
    throw new BetaHttpError("EMAIL_NOT_VERIFIED", "请先验证邮箱", 403)
  const tokenHash = hashInviteToken(input.token)

  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(betaInvites)
      .where(eq(betaInvites.tokenHash, tokenHash))
      .for("update")
    if (!invite)
      throw new BetaHttpError("INVITE_INVALID", "邀请无效或已过期", 400)

    const [entry] = await tx
      .select()
      .from(betaWaitlistEntries)
      .where(eq(betaWaitlistEntries.id, invite.waitlistId))
      .for("update")
    const [account] = await tx
      .select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update")
    if (!entry || !account || !account.emailVerified)
      throw new BetaHttpError("INVITE_INVALID", "邀请无效或已过期", 400)
    if (
      normalizeWaitlistEmail(account.email) !== entry.emailNormalized ||
      normalizeWaitlistEmail(input.email) !== entry.emailNormalized
    )
      throw new BetaHttpError("INVITE_EMAIL_MISMATCH", "请使用收到邀请的邮箱登录", 403)

    if (invite.usedAt) {
      if (entry.registeredUserId === input.userId)
        return { activated: true, replayed: true }
      throw new BetaHttpError("INVITE_INVALID", "邀请无效或已过期", 400)
    }
    if (invite.revokedAt || invite.expiresAt <= new Date())
      throw new BetaHttpError("INVITE_INVALID", "邀请无效或已过期", 400)

    const [entitlement] = await tx
      .select()
      .from(userEntitlements)
      .where(eq(userEntitlements.userId, input.userId))
      .for("update")
    if (!entitlement) {
      await tx.insert(userEntitlements).values({
        userId: input.userId,
        plan: "beta",
        accountStatus: "active",
        grantSource: "beta-invite",
        grantedBy: invite.createdBy,
      })
    } else if (entitlement.accountStatus === "suspended") {
      throw new BetaHttpError("ACCOUNT_SUSPENDED", "账号已暂停", 403)
    } else if (
      entitlement.plan === "pro" &&
      entitlement.planExpiresAt &&
      entitlement.planExpiresAt <= new Date()
    ) {
      await tx
        .update(userEntitlements)
        .set({
          plan: "beta",
          planExpiresAt: null,
          grantSource: "beta-invite",
          grantedBy: invite.createdBy,
          updatedAt: new Date(),
        })
        .where(eq(userEntitlements.userId, input.userId))
    }

    await grantWelcomeCreditsInTransaction(tx, input.userId)
    await tx
      .update(betaInvites)
      .set({ usedAt: new Date() })
      .where(eq(betaInvites.id, invite.id))
    await tx
      .update(betaEmailOutbox)
      .set({ encryptedPayload: null, nextAttemptAt: null, updatedAt: new Date() })
      .where(eq(betaEmailOutbox.inviteId, invite.id))
    await tx
      .update(betaWaitlistEntries)
      .set({
        status: "registered",
        registeredUserId: input.userId,
        updatedAt: new Date(),
      })
      .where(eq(betaWaitlistEntries.id, entry.id))
    await tx.insert(adminAuditLogs).values({
      id: randomUUID(),
      actorId: input.userId,
      action: "beta.invite.redeem",
      targetType: "beta_invite",
      targetId: invite.id,
      reason: "invited-user-activation",
      requestId: input.requestId,
      metadata: { waitlistId: entry.id, userId: input.userId },
    })
    return { activated: true, replayed: false }
  })
}
