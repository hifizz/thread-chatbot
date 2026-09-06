import { z } from "zod"
import { SHARE_EXPIRIES, SHARE_LIMITS } from "@/constants/sharing"

const id = z.string().min(1).max(128).regex(/^[\w-]+$/)
const coordinate = z.number().finite().min(-SHARE_LIMITS.coordinate).max(SHARE_LIMITS.coordinate)
const width = z.number().finite().min(SHARE_LIMITS.minWidth).max(SHARE_LIMITS.maxWidth)
const text = z.string().max(SHARE_LIMITS.text)
export const shareLayoutSchema = z.object({
  view: z.enum(["columns", "canvas"]).default("columns"),
  slots: z.array(z.object({ id, folded: z.boolean() }).strict()).max(SHARE_LIMITS.threads).default([]),
  widths: z.record(id, width).refine((v) => Object.keys(v).length <= SHARE_LIMITS.threads).default({}),
  focusId: id.nullable().default(null),
  columnCount: z.number().int().min(1).max(4).default(2),
  placementMode: z.enum(["replace", "fold"]).default("fold"),
  pins: z.array(z.object({ id, x: coordinate, y: coordinate }).strict()).max(SHARE_LIMITS.threads).default([]),
  viewport: z.object({ x: coordinate, y: coordinate, zoom: z.number().finite().min(0.2).max(1.75) }).strict().nullable().default(null),
  artifactId: id.nullable().default(null),
  panelWidth: width.default(480),
}).strict()
const base = { commandId: z.uuid(), resourceId: id, expiry: z.enum(SHARE_EXPIRIES).default("unlimited") }
export const createShareSchema = z.discriminatedUnion("resourceType", [
  z.object({ ...base, resourceType: z.literal("project"), layout: shareLayoutSchema }).strict(),
  z.object({ ...base, resourceType: z.literal("artifact") }).strict(),
])
export const listSharesSchema = z.object({ resourceType: z.enum(["project", "artifact"]), resourceId: id }).strict()
export const sharePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text }),
  z.object({ type: z.literal("reasoning"), text }),
  z.object({ type: z.literal("quote"), text }),
  z.object({ type: z.literal("source"), title: text, url: text }),
  z.object({ type: z.literal("attachment") }),
])
export const publicMessageSchema = z.object({
  id, threadId: id, sequence: z.number().int().positive(), role: z.enum(["user", "assistant"]),
  status: z.enum(["generating", "completed", "stopped", "failed"]), historical: z.boolean(),
  parts: z.array(sharePartSchema),
})
const publicThreadSchema = z.object({
  id, parentId: id.nullable(), title: text, depth: z.number().int().nonnegative(),
  footnote: z.number().int().nullable(), anchorText: text.nullable(), forkMessageId: id.nullable(), forkContext: z.array(id),
  forkAnchor: z.object({ quote: z.object({ exact: text, prefix: text, suffix: text }) }).nullable(),
})
const artifactBody = { title: text, content: text, createdAt: z.iso.datetime() }
export const publicSnapshotSchema = z.discriminatedUnion("resourceType", [
  z.object({ schemaVersion: z.literal(1), resourceType: z.literal("project"), title: text, rootThreadId: id,
    threads: z.array(publicThreadSchema).max(SHARE_LIMITS.threads), messages: z.array(publicMessageSchema).max(SHARE_LIMITS.messages),
    artifacts: z.array(z.object({ id, threadId: id, sourceMessageId: id, ...artifactBody })).max(SHARE_LIMITS.artifacts),
    layout: shareLayoutSchema,
  }),
  z.object({ schemaVersion: z.literal(1), resourceType: z.literal("artifact"), ...artifactBody }),
])
export type ShareLayout = z.infer<typeof shareLayoutSchema>
export type CreateShareInput = z.infer<typeof createShareSchema>
export type PublicSnapshot = z.infer<typeof publicSnapshotSchema>
export type PublicProjectSnapshot = Extract<PublicSnapshot, { resourceType: "project" }>
export type PublicMessage = z.infer<typeof publicMessageSchema>
export type ShareSummary = { id: string; path: string; createdAt: string; expiresAt: string | null; revokedAt: string | null; status: "active" | "expired" | "revoked" }

export function expiryDate(expiry: CreateShareInput["expiry"], now: Date): Date | null {
  return expiry === "unlimited" ? null : new Date(now.getTime() + Number(expiry) * 86400000)
}
export function isShareActive(share: { expiresAt: Date | null; revokedAt: Date | null }, now: Date) {
  return share.revokedAt === null && (share.expiresAt === null || now < share.expiresAt)
}
