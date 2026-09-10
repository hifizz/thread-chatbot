import { asc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { modelCatalog, modelCatalogAudit, modelCatalogSettings } from "@/lib/db/schema"
import { MODEL_CATALOG_SETTINGS_ID } from "@/constants/model-catalog"
import { modelCatalogConfigSchema, modelCatalogWriteSchema, type CatalogModel, type ModelCatalogWrite } from "./schema"
import { ModelCatalogError } from "./errors"
import { toPublicCatalogModel } from "./public"

export async function readModelCatalog() {
  // 一个 SELECT 同时读取模型与默认值，避免两次读取跨过并发修改。
  const rows = await db.select({ model: modelCatalog, settings: modelCatalogSettings })
    .from(modelCatalog)
    .innerJoin(modelCatalogSettings, eq(modelCatalogSettings.id, MODEL_CATALOG_SETTINGS_ID))
    .orderBy(asc(modelCatalog.sortOrder), asc(modelCatalog.id))
  if (!rows[0]) throw new ModelCatalogError("模型目录尚未初始化，请联系管理员", 503)
  return { models: rows.map(({ model }) => ({ ...model, config: modelCatalogConfigSchema.parse(model.config) })), ...rows[0].settings }
}
export async function readPublicModelCatalog() {
  const catalog = await readModelCatalog()
  return { models: catalog.models.filter((m) => m.enabled).map(toPublicCatalogModel), defaultModelId: catalog.defaultModelId }
}
export async function requireCatalogModel(id: string, connection: Pick<typeof db, "select"> = db): Promise<CatalogModel> {
  const [row] = await connection.select().from(modelCatalog).where(eq(modelCatalog.id, id))
  if (!row?.enabled) throw new ModelCatalogError("模型已停用或不存在，请重新选择模型", 400)
  return { ...row, config: modelCatalogConfigSchema.parse(row.config) }
}

/** 共享设置行先加锁，使设置默认与停用在并发操作下仍保持一致。 */
export async function saveCatalogModel(actorId: string, input: ModelCatalogWrite) {
  const value = modelCatalogWriteSchema.parse(input)
  return db.transaction(async (tx) => {
    const [settings] = await tx.select().from(modelCatalogSettings).where(eq(modelCatalogSettings.id, MODEL_CATALOG_SETTINGS_ID)).for("update")
    if (!settings) throw new ModelCatalogError("请先初始化模型目录", 503)
    const [previous] = await tx.select().from(modelCatalog).where(eq(modelCatalog.id, value.id)).for("update")
    if ((previous?.version ?? 0) !== value.version) throw new ModelCatalogError("配置已被其他操作更新，请刷新后重试", 409)
    if (!value.enabled && settings.defaultModelId === value.id) throw new ModelCatalogError("请先选择其他默认模型，再停用此模型", 409)
    const values = { ...value, version: value.version + 1, updatedBy: actorId, updatedAt: new Date() }
    const [saved] = previous
      ? await tx.update(modelCatalog).set(values).where(eq(modelCatalog.id, value.id)).returning()
      : await tx.insert(modelCatalog).values(values).returning()
    await tx.insert(modelCatalogAudit).values({ actorId, targetId: value.id, before: previous ?? null, after: saved })
    return saved
  })
}
export async function setDefaultCatalogModel(actorId: string, id: string, version: number) {
  return db.transaction(async (tx) => {
    const [previous] = await tx.select().from(modelCatalogSettings).where(eq(modelCatalogSettings.id, MODEL_CATALOG_SETTINGS_ID)).for("update")
    if (!previous || previous.version !== version) throw new ModelCatalogError("默认模型配置已更新，请刷新后重试", 409)
    const [model] = await tx.select().from(modelCatalog).where(eq(modelCatalog.id, id))
    if (!model?.enabled) throw new ModelCatalogError("只能将已启用模型设为默认", 400)
    const [saved] = await tx.update(modelCatalogSettings).set({ defaultModelId: id, version: version + 1 }).where(eq(modelCatalogSettings.id, MODEL_CATALOG_SETTINGS_ID)).returning()
    await tx.insert(modelCatalogAudit).values({ actorId, targetId: "default-model", before: previous, after: saved })
    return saved
  })
}
