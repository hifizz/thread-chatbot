import assert from "node:assert/strict"
import { createModelCatalogCache } from "../../lib/model-catalog/cache.ts"
import { MODEL_CATALOG_REFRESH_MS, MODEL_CATALOG_RETRY_MS } from "../../constants/model-catalog.ts"
import { fixtureModelCatalog } from "../fixtures/model-catalog.ts"
import { toPublicModelCatalog } from "../../lib/model-catalog/public.ts"
import { assertAllowedModel, assertAllowedGenerationSettings } from "../../lib/thread-chat/application/command-utils.ts"
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let time = 0, calls = 0
let loading = deferred()
const errors = [], work = []
const cache = createModelCatalogCache({ now: () => time, load: () => { calls++; return loading.promise }, onRefreshError: (error) => errors.push(error) })
const get = () => cache.get((task) => work.push(task))
const old = structuredClone(fixtureModelCatalog)
const cold = [get(), get(), get()]
await Promise.resolve()
assert.equal(calls, 1)
let settled = false
cold[0].then(() => { settled = true })
await Promise.resolve()
assert.equal(settled, false)
loading.resolve(old)
assert((await Promise.all(cold)).every((value) => value === old))
time = MODEL_CATALOG_REFRESH_MS - 1
assert.equal(await get(), old)
assert.equal(calls, 1)
assert.equal(work.length, 0)
time++
loading = deferred()
assert((await Promise.all([get(), get(), get()])).every((value) => value === old))
assert.equal(work.length, 1, "过期请求只调度一次后台刷新")
const refresh = work.shift()()
await Promise.resolve()
assert.equal(calls, 2)
assert.equal(await get(), old, "数据库阻塞时立即返回旧对象")
const fresh = structuredClone(old)
fresh.version++
fresh.models[0].config.name = "缓存更新后的名称"
loading.resolve(fresh)
await refresh
assert.equal(await get(), fresh)
assert.notEqual(old.models[0].config.name, fresh.models[0].config.name)
assert.equal(old.version, 1, "已启动请求保留原快照")
time += MODEL_CATALOG_REFRESH_MS
loading = deferred()
assert.equal(await get(), fresh)
const failed = work.shift()()
loading.reject(new Error("数据库不可用"))
await failed
assert.equal(errors.length, 1)
assert.equal(await get(), fresh)
assert.equal(work.length, 0)
time += MODEL_CATALOG_RETRY_MS - 1
await get()
assert.equal(work.length, 0)
time++
loading = deferred()
await get()
assert.equal(work.length, 1)
const retry = work.shift()()
loading.resolve(old)
await retry
assert.equal(await get(), old)
const unavailable = createModelCatalogCache({ load: async () => { throw new Error("cold failure") } })
await assert.rejects(unavailable.get(() => {}), /cold failure/)
await assert.rejects(unavailable.get(() => {}), /cold failure/)
const invalid = createModelCatalogCache({ load: async () => ({ ...old, defaultModelId: "missing" }) })
await assert.rejects(invalid.get(() => {}), /刷新页面/)
const disabled = structuredClone(old)
disabled.models.find((m) => m.id === old.defaultModelId).enabled = false
assert.equal(assertAllowedModel(old, old.defaultModelId), undefined)
assert.throws(() => assertAllowedModel(disabled, old.defaultModelId), /刷新页面/)
assert.throws(() => assertAllowedGenerationSettings(old, old.defaultModelId, { maxOutputTokens: -1 }), /刷新页面/)
const publicText = JSON.stringify(toPublicModelCatalog(old))
assert(!publicText.includes('"upstreamId"'))
assert(!publicText.includes('"profile"'))
console.log("PASS 缓存：冷启动、五分钟边界、过期立即返回、单次刷新、原子替换、失败重试、快照稳定、同步校验及公开字段")
