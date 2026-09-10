import assert from "node:assert/strict"
import { eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { user, modelCatalogAudit, modelCatalog } from "../../lib/db/schema.ts"
import { seedModelCatalog } from "../../lib/model-catalog/seed.ts"
import { readModelCatalog, readPublicModelCatalog, saveCatalogModel, setDefaultCatalogModel, requireCatalogModel } from "../../lib/model-catalog/repository.ts"
import { assertAllowedModel, assertAllowedGenerationSettings, assertModelSupportsNewAttachments } from "../../lib/thread-chat/application/command-utils.ts"
const url = new URL(process.env.DATABASE_URL)
assert(["localhost", "127.0.0.1"].includes(url.hostname), "仅允许独立本地测试库")
assert.equal(process.env.ADMIN_CATALOG_TEST_WRITES, "1", "需显式允许测试写入")
const id = `catalog-test-${crypto.randomUUID()}`
const actorId = `catalog-actor-${crypto.randomUUID()}`
await db.insert(user).values({ id: actorId, name: "目录测试", email: `${actorId}@example.test` })
await seedModelCatalog()
const initial = await readModelCatalog()
const value = {
  id, enabled: true, sortOrder: 0, version: 0,
  config: { name: "DB 新模型", description: "", upstreamId: "new-test-model", logo: "auto", profile: "openai-chat", contextWindow: 32000, imageInput: false, toolCalling: false, reasoning: true, effortLevels: ["low", "high"], defaultEffort: "low", maxOutputTokens: 8192, outputTokenOptions: [2048, 8192], defaultMaxOutputTokens: 2048 },
}
try {
  const saved = await saveCatalogModel(actorId, value)
  assert.equal(saved.version, 1)
  assert.equal((await requireCatalogModel(id)).config.defaultEffort, "low")
  await assertAllowedModel(id)
  await assertAllowedGenerationSettings(id, { effort: "low", maxOutputTokens: 8192 })
  await assert.rejects(assertAllowedGenerationSettings(id, { effort: "max", maxOutputTokens: 8192 }))
  await assert.rejects(assertModelSupportsNewAttachments(id, [{ mediaType: "image/png", url: "fixture" }]))
  const snapshot = await requireCatalogModel(id)
  const updated = await saveCatalogModel(actorId, { ...value, version: 1, config: { ...value.config, defaultEffort: "high", imageInput: true } })
  assert.equal(updated.version, 2)
  await assertModelSupportsNewAttachments(id, [{ mediaType: "image/png", url: "fixture" }])
  assert.equal(snapshot.config.defaultEffort, "low", "已读取快照保持旧值")
  assert.equal((await requireCatalogModel(id)).config.defaultEffort, "high")
  await assert.rejects(saveCatalogModel(actorId, { ...value, version: 1 }), (error) => error.status === 409)
  const audit = await db.select().from(modelCatalogAudit).where(eq(modelCatalogAudit.targetId, id))
  assert.equal(audit.length, 2, "失败写入不产生审计记录")
  assert.equal(audit[1].actorId, actorId)
  const selected = await setDefaultCatalogModel(actorId, id, initial.version)
  await assert.rejects(saveCatalogModel(actorId, { ...value, enabled: false, version: 2 }), (error) => error.status === 409)
  await setDefaultCatalogModel(actorId, initial.defaultModelId, selected.version)
  await saveCatalogModel(actorId, { ...value, enabled: false, version: 2 })
  await assert.rejects(requireCatalogModel(id))
  assert(!(await readPublicModelCatalog()).models.some((m) => m.id === id))
  await seedModelCatalog()
  assert.equal((await readModelCatalog()).models.find((m) => m.id === id).enabled, false)
  console.log("PASS 独立数据库：新增、更新、能力校验、快照、审计、版本冲突、默认保护、停用与幂等初始化")
} finally {
  const current = await readModelCatalog()
  if (current.defaultModelId === id) await setDefaultCatalogModel(actorId, initial.defaultModelId, current.version)
  await db.delete(modelCatalog).where(eq(modelCatalog.id, id))
  await db.delete(user).where(eq(user.id, actorId))
  await globalThis.__dbClient?.end()
}
