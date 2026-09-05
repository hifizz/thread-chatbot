import assert from "node:assert/strict"
import { after, mock, test } from "node:test"
import { randomUUID } from "node:crypto"
import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite-pgvector"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { pushSchema } from "drizzle-kit/api"
import * as schema from "../../lib/db/schema.ts"
import { sharingFixture } from "./snapshot-sharing-fixture.mjs"

// 进程内、全新 PostgreSQL WASM 库；不会读取 DATABASE_URL 或接触已有数据。
// 单连接测试不声称覆盖真实多连接事务竞争；该门槛须在集成 PostgreSQL 上运行。
const client = await PGlite.create({ extensions: { vector } })
await client.exec("CREATE EXTENSION vector")
const db = drizzle(client, { schema })
const plan = await pushSchema(schema, db, ["thread_chat"])
await plan.apply()
mock.module(new URL("../../lib/db/index.ts", import.meta.url).href, { namedExports: { db } })
process.env.BETTER_AUTH_SECRET = "snapshot-sharing-test-secret-with-more-than-32-characters"
process.env.BETTER_AUTH_URL = "http://localhost:3000"
const { createShare, listShares, revokeShare, readPublicShare } = await import("../../lib/thread-chat/application/sharing.ts")
const { findActiveShare } = await import("../../lib/thread-chat/persistence/share-repository.ts")
const { auth } = await import("../../lib/auth/index.ts")
const { POST, GET } = await import("../../app/api/thread-chat/v1/shares/route.ts")
const { DELETE } = await import("../../app/api/thread-chat/v1/shares/[shareId]/route.ts")
const { GET: PUBLIC_GET } = await import("../../app/api/share/[token]/route.ts")
after(async () => { mock.restoreAll(); await client.close() })

test("数据库结构与分享生命周期", async (t) => {
  const f = sharingFixture()
  await db.insert(schema.user).values([{ id: "owner", name: "测试所有者", email: "owner@sharing.test" }, { id: "other", name: "其他测试用户", email: "other@sharing.test" }])
  await db.insert(schema.projects).values(f.project)
  for (const thread of f.threads) {
    await db.insert(schema.threads).values(thread)
    await db.insert(schema.messages).values(f.messages.filter((m) => m.threadId === thread.id))
  }
  await db.insert(schema.artifacts).values(f.artifacts)
  const input = { commandId: randomUUID(), resourceType: "project", resourceId: f.project.id, expiry: "3", layout: f.layout }
  const first = await createShare("owner", input)
  const token = first.result.path.split("/").at(-1)
  const frozen = await readPublicShare(token)
  await t.test("公开快照与私有字段隔离，匿名结果不查询来源", async () => {
    assert.ok(frozen)
    assert.equal(JSON.stringify(frozen).includes("PRIVATE_SENTINEL"), false)
    assert.equal(frozen.snapshot.threads.length, 3)
    assert.equal((await listShares("other", "project", f.project.id)).length, 0)
    await assert.rejects(createShare("other", { ...input, commandId: randomUUID() }), /资源不存在/)
    await assert.rejects(revokeShare("other", first.result.id), /资源不存在/)
  })
  await t.test("同命令重放不读取新内容、不重发 token、不延长期限；新命令得到新快照", async () => {
    await db.update(schema.projects).set({ customTitle: "修改后的标题", archivedAt: new Date() }).where(eq(schema.projects.id, f.project.id))
    await db.update(schema.messages).set({ parts: [{ type: "text", text: "后续编辑" }] }).where(eq(schema.messages.id, "branch-answer"))
    const replay = await createShare("owner", input)
    assert.equal(replay.replayed, true); assert.deepEqual(replay.result, first.result)
    assert.deepEqual(await readPublicShare(token), frozen)
    await assert.rejects(createShare("owner", { ...input, expiry: "7" }), /commandId/)
    const next = await createShare("owner", { ...input, commandId: randomUUID() })
    assert.notEqual(next.result.path, first.result.path)
    assert.equal((await readPublicShare(next.result.path.split("/").at(-1))).snapshot.title, "修改后的标题")
  })
  await t.test("全部期限和数据库截止边界", async () => {
    for (const expiry of ["unlimited", "3", "7", "30"]) {
      const created = await createShare("owner", { ...input, commandId: randomUUID(), expiry })
      const row = created.result, currentToken = row.path.split("/").at(-1)
      if (expiry === "unlimited") assert.equal(row.expiresAt, null)
      else {
        assert.equal(Date.parse(row.expiresAt) - Date.parse(row.createdAt), Number(expiry) * 86400000)
        assert.ok(await findActiveShare(db, currentToken, new Date(Date.parse(row.expiresAt) - 1)))
        assert.equal(await findActiveShare(db, currentToken, new Date(row.expiresAt)), null)
      }
    }
  })
  await t.test("撤销幂等，JSON 立即不可用且有禁止缓存响应头", async () => {
    await revokeShare("owner", first.result.id)
    const [before] = await db.select().from(schema.shares).where(eq(schema.shares.id, first.result.id))
    await revokeShare("owner", first.result.id)
    const [after] = await db.select().from(schema.shares).where(eq(schema.shares.id, first.result.id))
    assert.equal(+before.revokedAt, +after.revokedAt)
    assert.equal(await readPublicShare(token), null)
    const response = await PUBLIC_GET(new Request(`http://localhost:3000/api/share/${token}`), { params: Promise.resolve({ token }) })
    assert.equal(response.status, 404)
    assert.match(response.headers.get("cache-control"), /no-store/)
    assert.equal(response.headers.get("referrer-policy"), "no-referrer")
    assert.equal(JSON.stringify(await response.json()).includes(f.project.customTitle), false)
  })
  await t.test("独立 Artifact 快照不包含来源 ID，非法来源不留下命令回执或半份快照", async () => {
    const artifactInput = { commandId: randomUUID(), resourceType: "artifact", resourceId: "document", expiry: "unlimited" }
    const created = await createShare("owner", artifactInput)
    const result = await readPublicShare(created.result.path.split("/").at(-1))
    assert.equal(result.snapshot.resourceType, "artifact")
    assert.equal("threadId" in result.snapshot, false)
    await db.update(schema.messages).set({ status: "failed" }).where(eq(schema.messages.id, "branch-answer"))
    const failed = { ...artifactInput, commandId: randomUUID() }
    await assert.rejects(createShare("owner", failed), /SHARE_INVALID_SOURCE/)
    assert.equal((await db.select().from(schema.conversationCommands).where(eq(schema.conversationCommands.id, failed.commandId))).length, 0)
    await db.update(schema.messages).set({ status: "completed" }).where(eq(schema.messages.id, "branch-answer"))
  })
  await t.test("来源删除级联失效，用户删除也不留下公开记录", async () => {
    const links = await listShares("owner", "project", f.project.id)
    await db.delete(schema.projects).where(eq(schema.projects.id, f.project.id))
    for (const link of links) assert.equal(await readPublicShare(link.path.split("/").at(-1)), null)
    await db.insert(schema.projects).values({ id: "user-cascade-project", userId: "owner" })
    await db.insert(schema.threads).values({ id: "user-cascade-root", projectId: "user-cascade-project", modelId: "test-model", depth: 0 })
    const link = await createShare("owner", { ...input, commandId: randomUUID(), resourceId: "user-cascade-project" })
    await db.delete(schema.user).where(eq(schema.user.id, "owner"))
    assert.equal(await readPublicShare(link.result.path.split("/").at(-1)), null)
  })
})

test("真实登录授权下的分享 HTTP handler", async () => {
  const signup = await auth.api.signUpEmail({ body: { name: "分享接口测试", email: "api@sharing.test", password: "generated-local-test-password" }, asResponse: true })
  assert.equal(signup.status, 200)
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
  const account = await signup.json()
  await db.insert(schema.projects).values({ id: "api-project", userId: account.user.id, customTitle: "API 快照" })
  await db.insert(schema.threads).values({ id: "api-root", projectId: "api-project", modelId: "test-model", depth: 0 })
  const input = { commandId: randomUUID(), resourceType: "project", resourceId: "api-project", layout: {} }
  const request = (body, headers = {}) => new Request("http://localhost:3000/api/thread-chat/v1/shares", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
  assert.equal((await POST(request(input))).status, 401)
  assert.equal((await POST(request({ ...input, ownerId: "attacker" }, { cookie }))).status, 400)
  assert.equal((await POST(request(input, { cookie, origin: "https://other.example" }))).status, 403)
  const response = await POST(request(input, { cookie }))
  assert.equal(response.status, 200)
  const result = await response.json(), token = result.data.path.split("/").at(-1)
  const publicResponse = await PUBLIC_GET(new Request(`http://localhost:3000/api/share/${token}`), { params: Promise.resolve({ token }) })
  assert.equal(publicResponse.status, 200)
  assert.equal((await publicResponse.json()).snapshot.title, "API 快照")
  assert.equal((await GET(new Request("http://localhost:3000/api/thread-chat/v1/shares?resourceType=project&resourceId=api-project", { headers: { cookie } }))).status, 200)
  assert.equal((await DELETE(new Request("http://localhost:3000/api/thread-chat/v1/shares/x", { method: "DELETE", headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ shareId: result.data.id }) })).status, 401)
  const revoke = await DELETE(new Request("http://localhost:3000/api/thread-chat/v1/shares/x", { method: "DELETE", headers: { cookie } }), { params: Promise.resolve({ shareId: result.data.id }) })
  assert.equal(revoke.status, 200)
  assert.equal(await readPublicShare(token), null)
})
