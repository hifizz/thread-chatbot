import { z } from "zod"
import type { ProjectBootstrapDTO } from "@/lib/thread-chat/contracts/dto"
import {
  SHARE_EXPIRY_VALUES,
  SHARE_LIMITS,
} from "@/constants/sharing"

/* ========== 创建命令（判别联合，严格拒绝正文/owner/token/自定义字段） ========== */

export const shareExpirySchema = z.enum(SHARE_EXPIRY_VALUES)
export type ShareExpiryInput = z.infer<typeof shareExpirySchema>

const idSchema = z.uuid()
const coordSchema = z
  .number()
  .min(-SHARE_LIMITS.coordinate)
  .max(SHARE_LIMITS.coordinate)
const panelSizeSchema = z.number().min(0).max(SHARE_LIMITS.panelSize)

/** 首屏布局白名单：来源是客户端 workspace 状态，服务端只校验界内与快照内引用。 */
export const shareLayoutSchema = z
  .object({
    view: z.enum(["columns", "canvas"]),
    columnSlots: z
      .array(
        z
          .object({ threadId: idSchema, folded: z.boolean() })
          .strict()
      )
      .max(SHARE_LIMITS.columnSlots),
    columnWidths: z
      .record(idSchema, panelSizeSchema)
      .refine(
        (value) => Object.keys(value).length <= SHARE_LIMITS.columnWidths,
        { message: "columnWidths 过多" }
      ),
    forceColumns: z.number().int().min(1).max(8).nullable(),
    placementMode: z.enum(["replace", "fold"]),
    selectedThreadId: idSchema.nullable(),
    canvas: z
      .object({
        pins: z
          .record(
            idSchema,
            z.object({ x: coordSchema, y: coordSchema }).strict()
          )
          .refine(
            (value) => Object.keys(value).length <= SHARE_LIMITS.canvasPins,
            { message: "canvas pins 过多" }
          ),
        viewport: z
          .object({
            x: coordSchema,
            y: coordSchema,
            zoom: z.number().min(SHARE_LIMITS.zoomMin).max(SHARE_LIMITS.zoomMax),
          })
          .strict()
          .optional(),
      })
      .strict(),
    panelSizes: z
      .object({
        columns: z.array(panelSizeSchema).max(16).optional(),
        artifactDrawer: panelSizeSchema.optional(),
        projectPanel: panelSizeSchema.optional(),
      })
      .strict(),
    expandedNodes: z
      .array(z.string().max(200))
      .max(SHARE_LIMITS.expandedNodes),
    activeArtifactId: idSchema.nullable(),
    drawerOpen: z.boolean(),
  })
  .strict()

export type PublicLayout = z.infer<typeof shareLayoutSchema>

export const createShareCommandSchema = z.discriminatedUnion("resourceType", [
  z
    .object({
      commandId: idSchema,
      resourceType: z.literal("project"),
      projectId: idSchema,
      expiresIn: shareExpirySchema.optional(),
      layout: shareLayoutSchema,
    })
    .strict(),
  z
    .object({
      commandId: idSchema,
      resourceType: z.literal("document"),
      documentId: idSchema,
      expiresIn: shareExpirySchema.optional(),
    })
    .strict(),
])
export type CreateShareCommand = z.infer<typeof createShareCommandSchema>

export const listSharesQuerySchema = z
  .object({
    resourceType: z.enum(["project", "document"]),
    resourceId: idSchema,
  })
  .strict()
export type ListSharesQuery = z.infer<typeof listSharesQuerySchema>

/* ========== 管理面 DTO ========== */

export type ShareStatus = "active" | "expired" | "revoked"

export interface ShareDTO {
  id: string
  resourceType: "project" | "document"
  resourceId: string
  token: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  status: ShareStatus
}

export interface CreateShareResult {
  share: ShareDTO
}

/* ========== 公开快照契约 ==========
 * entities 与 ProjectBootstrapDTO 同形是为了让 hydrateProject/视图层免适配复用；
 * 字段值由白名单构造器逐字段产出（私有字段常量填充、parts 已过滤、附件链接已清洗），
 * 绝不直接存放私有 Bootstrap 的浅拷贝。 */

export interface PublicProjectSnapshot {
  schemaVersion: 1
  kind: "project"
  createdAt: string
  entities: ProjectBootstrapDTO
  layout: PublicLayout
}

export interface PublicDocumentSnapshot {
  schemaVersion: 1
  kind: "document"
  createdAt: string
  document: {
    id: string
    title: string
    revisionId: string
    revisionNumber: number
    artifactId: string
    createdAt: string
  }
  content: string
}

export type PublicSnapshot = PublicProjectSnapshot | PublicDocumentSnapshot

export interface PublicShareResponse {
  resourceType: "project" | "document"
  createdAt: string
  snapshot: PublicSnapshot
}
