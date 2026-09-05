import assert from "node:assert/strict"
import { after, test } from "node:test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import * as schema from "../../lib/db/schema.ts"
import { sharingDatabase } from "./snapshot-sharing-database.mjs"
import { sharingFixture } from "./snapshot-sharing-fixture.mjs"

assert.ok(process.env.SNAPSHOT_SHARING_TEST_DATABASE_URL, "必须显式指定独立测试库")
const database = await sharingDatabase()
const { db } = database
const origin = "http://127.0.0.1:3111"
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3111"], {
  env: { ...process.env, DATABASE_URL: process.env.SNAPSHOT_SHARING_TEST_DATABASE_URL, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "snapshot-http-test-only-secret-at-least-32-characters", DB_POOL_MAX: "2" }, stdio: ["ignore", "pipe", "pipe"],
})
// Next 日志可能包含请求 URL；测试不转印正文或 bearer token。
server.stdout.resume(); server.stderr.resume()
after(async () => { server.kill("SIGTERM"); await database.close() })
let ready = false
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await fetch(origin + "/sign-in")).ok) { ready = true; break } } catch { /* 等待测试服务启动 */ }
  assert.equal(server.exitCode, null, "测试应用提前退出，请先执行生产构建")
  await new Promise((resolve) => setTimeout(resolve, 100))
}
assert.ok(ready, "测试应用未就绪")
const signup = await fetch(origin + "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ name: "分享端到端测试", email: "http@sharing.test", password: "generated-local-test-password" }) })
assert.equal(signup.status, 200)
const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
const owner = (await signup.json()).user
const f = sharingFixture()
await db.insert(schema.projects).values({ ...f.project, userId: owner.id })
for (const thread of f.threads) {
  await db.insert(schema.threads).values(thread)
  await db.insert(schema.messages).values(f.messages.filter((m) => m.threadId === thread.id))
}
await db.insert(schema.artifacts).values(f.artifacts)
async function create(resourceType = "project", extra = {}) {
  const response = await fetch(origin + "/api/thread-chat/v1/shares", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ commandId: randomUUID(), resourceType, resourceId: resourceType === "project" ? "project" : "document", ...(resourceType === "project" ? { layout: f.layout } : {}), ...extra }) })
  assert.equal(response.status, 200)
  return (await response.json()).data
}
async function read(share, kind, loggedIn = false) {
  const path = kind === "json" ? share.path.replace("/share/", "/api/share/") : share.path
  const response = await fetch(origin + path, { headers: { ...(kind === "rsc" ? { RSC: "1" } : {}), ...(loggedIn ? { cookie } : {}) }, redirect: "manual" })
  const body = await response.text()
  assert.match(response.headers.get("cache-control"), /no-store/)
  assert.equal(response.headers.get("referrer-policy"), "no-referrer")
  assert.match(response.headers.get("x-robots-tag"), /noindex/)
  assert.equal(body.includes("PRIVATE_SENTINEL"), false)
  if (kind === "rsc") assert.match(response.headers.get("content-type"), /text\/x-component/)
  return { response, body }
}
test("匿名及所有者的 JSON、HTML、RSC 输出一致且不包含秘密字段", async () => {
  const share = await create()
  for (const loggedIn of [false, true]) for (const kind of ["json", "html", "rsc"]) {
    const { response, body } = await read(share, kind, loggedIn)
    assert.equal(response.status, 200)
    assert.ok(body.includes(f.project.customTitle))
    assert.equal(/<textarea|contenteditable="true"|<img[\s>]/i.test(body), false)
    if (kind === "html") {
      assert.match(body, /<title>只读分享/)
      assert.match(body, /name="robots"[^>]*noindex/)
    }
  }
})
test("独立 Markdown 不返回来源目录或其他对话", async () => {
  const share = await create("artifact")
  for (const kind of ["json", "html", "rsc"]) {
    const { body } = await read(share, kind)
    assert.ok(body.includes("阅读体验设计"))
    assert.equal(body.includes(f.project.customTitle), false)
    assert.equal(body.includes("研究主线"), false)
    assert.equal(body.includes("如何让复杂研究更容易阅读"), false)
  }
})
test("已读链接撤销和到期后，各内容入口均不返回旧正文", async () => {
  for (const lifecycle of ["revoke", "expire", "delete"]) {
    const share = await create()
    for (const kind of ["json", "html", "rsc"]) assert.equal((await read(share, kind)).response.status, 200)
    if (lifecycle === "revoke") {
      const result = await fetch(origin + "/api/thread-chat/v1/shares/" + share.id, { method: "DELETE", headers: { cookie, origin } })
      assert.equal(result.status, 200)
    } else if (lifecycle === "expire") {
      await db.update(schema.shares).set({ createdAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.shares.id, share.id))
    } else await db.delete(schema.shares).where(eq(schema.shares.id, share.id))
    for (const loggedIn of [false, true]) for (const kind of ["json", "html", "rsc"]) {
      const { response, body } = await read(share, kind, loggedIn)
      assert.equal(response.status, kind === "json" ? 404 : 200)
      assert.ok(body.includes("分享不可用"))
      assert.equal(body.includes(f.project.customTitle), false)
      assert.equal(body.includes("阅读体验设计"), false)
    }
  }
})
test("分享 token 不放行相似页面、私有读取、附件或业务写入", async () => {
  const share = await create(), token = share.path.split("/").at(-1)
  for (const path of [share.path + "/private", "/share/invalid", "/thread-chat/project"]) {
    const response = await fetch(origin + path, { redirect: "manual" })
    assert.equal(response.status, 307)
    assert.ok(response.headers.get("location").includes("/sign-in"))
  }
  for (const [method, path] of [["GET", "/api/thread-chat/v1/projects/project"], ["GET", "/api/thread-chat/v1/messages/branch-answer"], ["GET", "/api/thread-chat/v1/artifacts/document"], ["GET", "/api/attachments/private/content"], ["POST", "/api/thread-chat/v1/messages/branch-answer/retry"], ["DELETE", "/api/thread-chat/v1/projects/project"]]) {
    const response = await fetch(origin + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) })
    assert.equal(response.status, 401, `${method} 私有接口仍需登录`)
  }
})
