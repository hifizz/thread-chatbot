import assert from "node:assert/strict"
import { config } from "dotenv"

config({ path: ".env.local" })

const source = process.env.DATABASE_URL
assert.ok(source, "测试需要 DATABASE_URL")
assert.ok(process.env.BETTER_AUTH_SECRET, "测试需要 BETTER_AUTH_SECRET")

const testUrl = new URL(source.trim().replace(/^(['"])(.*)\1$/, "$2"))
process.env.DATABASE_URL = testUrl.toString()
process.env.DIRECT_URL = testUrl.toString()

const [
  { eq },
  { makeSignature },
  { auth },
  { db },
  schema,
  sharesRoute,
  shareIdRoute,
  publicRoute,
] = await Promise.all([
  import("drizzle-orm"),
  import("better-auth/crypto"),
  import("../../lib/auth/index.ts"),
  import("../../lib/db/index.ts"),
  import("../../lib/db/schema.ts"),
  import("../../app/api/thread-chat/v1/shares/route.ts"),
  import("../../app/api/thread-chat/v1/shares/[shareId]/route.ts"),
  import("../../app/api/share/[token]/route.ts"),
])

const id = () => crypto.randomUUID()
const prefix = `share-${id()}`
const ownerId = `${prefix}-owner`
const otherId = `${prefix}-other`

function routeContext(key, value) {
  return { params: Promise.resolve({ [key]: value }) }
}

function apiRequest(path, { method = "GET", cookie, body } = {}) {
  const headers = new Headers()
  if (cookie) headers.set("cookie", cookie)
  if (body !== undefined) headers.set("content-type", "application/json")
  return new Request(`http://thread-chat.test${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

async function responseJson(response, expectedStatus = 200) {
  assert.equal(
    response.status,
    expectedStatus,
    `HTTP ${response.status}: ${await response.clone().text()}`
  )
  return response.json()
}

async function createUserAndSession(userId, token, suffix) {
  const now = new Date()
  await db.insert(schema.user).values({
    id: userId,
    name: `Share ${suffix}`,
    email: `${prefix}-${suffix}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.session).values({
    id: id(),
    token,
    userId,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  })
}

async function sessionCookie(token) {
  const signature = await makeSignature(token, process.env.BETTER_AUTH_SECRET)
  const context = await auth.$context
  return `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`
}

const layout = {
  view: "columns",
  columnSlots: [],
  columnWidths: {},
  forceColumns: null,
  placementMode: "replace",
  selectedThreadId: null,
  canvas: { pins: {} },
  panelSizes: {},
  expandedNodes: [],
  activeArtifactId: null,
  drawerOpen: false,
}

let ownerCookie
let otherCookie
const projectId = id()
const rootThreadId = id()
const branchThreadId = id()
const userMessageId = id()
const oldAssistantId = id()
const newAssistantId = id()
const orphanOldId = id()
const artifactId = id()
const documentId = id()
const revisionId = id()
let createdShareId

try {
  await createUserAndSession(ownerId, `${prefix}-owner-session`, "owner")
  await createUserAndSession(otherId, `${prefix}-other-session`, "other")
  ownerCookie = await sessionCookie(`${prefix}-owner-session`)
  otherCookie = await sessionCookie(`${prefix}-other-session`)

  // 直接装配一个带分支、被替换消息、Artifact 与文档的 Project。
  await db.insert(schema.projects).values({
    id: projectId,
    userId: ownerId,
    autoTitle: "分享夹具",
    instructions: "INSTRUCTIONS_SENTINEL",
    target: "TARGET_SENTINEL",
  })
  await db.insert(schema.threads).values({
    id: rootThreadId,
    projectId,
    parentId: null,
    depth: 0,
    modelId: "gpt-test",
  })
  const finished = new Date()
  await db.insert(schema.messages).values([
    {
      id: userMessageId, projectId, threadId: rootThreadId, sequence: 1, role: "user",
      parts: [{ type: "text", text: "做一个文档，附件 /api/attachments/priv" }],
      status: "completed", modelId: null, finishedAt: finished,
    },
    {
      id: oldAssistantId, projectId, threadId: rootThreadId, sequence: 2, role: "assistant",
      parts: [
        { type: "tool-createMarkdownArtifact", toolCallId: "call-1", state: "output-available",
          input: { title: "方案", content: "# 方案" }, output: { created: true, artifactId } },
        { type: "text", text: "旧回答 /api/attachments/inner" },
      ],
      status: "completed", modelId: "gpt-test", finishedAt: finished, supersededAt: finished,
      feedback: "up", providerUsage: { inputTokens: 9 },
      errorCode: "ERR_SENTINEL", errorMessage: "ERROR_SENTINEL",
    },
  ])
  await db.insert(schema.threads).values({
    id: branchThreadId,
    projectId,
    parentId: rootThreadId,
    forkMessageId: oldAssistantId,
    forkContext: [oldAssistantId],
    forkAnchor: { quote: { exact: "旧回答", prefix: "", suffix: "" } },
    anchorText: "旧回答",
    footnote: 2,
    depth: 1,
    modelId: "gpt-test",
  })
  await db.insert(schema.messages).values([
    {
      id: newAssistantId, projectId, threadId: rootThreadId, sequence: 3, role: "assistant",
      parts: [{ type: "text", text: "新回答" }],
      status: "completed", modelId: "gpt-test", finishedAt: finished,
      replacesMessageId: oldAssistantId,
    },
    {
      id: orphanOldId, projectId, threadId: branchThreadId, sequence: 1, role: "assistant",
      parts: [{ type: "text", text: "无关旧消息 ORPHAN_SENTINEL" }],
      status: "completed", modelId: "gpt-test", finishedAt: finished, supersededAt: finished,
    },
  ])
  await db.insert(schema.artifacts).values({
    id: artifactId, projectId, threadId: rootThreadId, sourceMessageId: oldAssistantId,
    kind: "markdown", title: "方案", content: "# 方案\n见附件 /api/attachments/doc",
  })
  await db.insert(schema.documents).values({ id: documentId, projectId })
  await db.insert(schema.documentRevisions).values({
    id: revisionId, documentId, projectId, revisionNumber: 1, artifactId,
    changeSummary: "初稿", edits: [], actorUserId: ownerId, executionId: oldAssistantId,
  })
  await db.update(schema.documents).set({ currentRevisionId: revisionId }).where(eq(schema.documents.id, documentId))

  /* ---- 创建：幂等 + 白名单 ---- */
  const createBody = {
    commandId: id(), resourceType: "project", projectId,
    expiresIn: "d7",
    layout: { ...layout, columnSlots: [{ threadId: rootThreadId, folded: false }] },
  }
  const created = await responseJson(
    await sharesRoute.POST(apiRequest("/api/thread-chat/v1/shares", { method: "POST", cookie: ownerCookie, body: createBody }))
  )
  assert.equal(created.ok, true)
  assert.equal(created.replayed, false)
  const share = created.data.share
  createdShareId = share.id
  assert.equal(share.status, "active")
  assert.match(share.token, /^[A-Za-z0-9_-]{32}$/)
  assert.ok(share.expiresAt)

  const replayed = await responseJson(
    await sharesRoute.POST(apiRequest("/api/thread-chat/v1/shares", { method: "POST", cookie: ownerCookie, body: createBody }))
  )
  assert.equal(replayed.replayed, true)
  assert.equal(replayed.data.share.token, share.token, "重放不得重新生成 token")

  const conflict = await sharesRoute.POST(
    apiRequest("/api/thread-chat/v1/shares", { method: "POST", cookie: ownerCookie, body: { ...createBody, expiresIn: "d30" } })
  )
  await responseJson(conflict, 409)
  console.log("创建与 commandId 幂等：6 项通过")

  /* ---- 匿名公开读 ---- */
  const snapshotJson = JSON.stringify(
    (await db.select({ snapshot: schema.shares.snapshot }).from(schema.shares).where(eq(schema.shares.id, share.id)))[0].snapshot
  )
  for (const sentinel of ["INSTRUCTIONS_SENTINEL", "TARGET_SENTINEL", "ERROR_SENTINEL", "ORPHAN_SENTINEL", "/api/attachments/"])
    assert.ok(!snapshotJson.includes(sentinel), `快照不得包含 ${sentinel}`)
  assert.ok(snapshotJson.includes("旧回答"), "被替换的分支来源消息应在快照内")

  const publicGet = await publicRoute.GET(
    apiRequest(`/api/share/${share.token}`),
    routeContext("token", share.token)
  )
  assert.equal(publicGet.headers.get("cache-control"), "private, no-store, max-age=0")
  const publicBody = await responseJson(publicGet)
  assert.equal(publicBody.resourceType, "project")
  assert.equal(publicBody.snapshot.entities.project.id, projectId)
  assert.equal(publicBody.snapshot.entities.project.instructions, null)
  assert.equal(publicBody.snapshot.layout.columnSlots[0].threadId, rootThreadId)
  const msgIds = new Set(publicBody.snapshot.entities.messages.map((m) => m.id))
  assert.ok(msgIds.has(oldAssistantId) && msgIds.has(newAssistantId) && !msgIds.has(orphanOldId))
  const oldMsg = publicBody.snapshot.entities.messages.find((m) => m.id === oldAssistantId)
  assert.equal(oldMsg.feedback, null)
  assert.equal(oldMsg.error, null)
  console.log("快照白名单与匿名读：11 项通过")

  /* ---- 列表与撤销 ---- */
  const listed = await responseJson(
    await sharesRoute.GET(apiRequest(`/api/thread-chat/v1/shares?resourceType=project&resourceId=${projectId}`, { cookie: ownerCookie }))
  )
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, share.id)

  const revoked = await responseJson(
    await shareIdRoute.DELETE(
      apiRequest(`/api/thread-chat/v1/shares/${share.id}`, { method: "DELETE", cookie: ownerCookie }),
      routeContext("shareId", share.id)
    )
  )
  assert.equal(revoked.share.status, "revoked")
  const again = await responseJson(
    await shareIdRoute.DELETE(
      apiRequest(`/api/thread-chat/v1/shares/${share.id}`, { method: "DELETE", cookie: ownerCookie }),
      routeContext("shareId", share.id)
    )
  )
  assert.equal(again.share.status, "revoked", "重复撤销幂等")
  const gone = await publicRoute.GET(apiRequest(`/api/share/${share.token}`), routeContext("token", share.token))
  await responseJson(gone, 404)
  const badToken = await publicRoute.GET(apiRequest("/api/share/not-a-token"), routeContext("token", "not-a-token"))
  await responseJson(badToken, 404)
  console.log("列表、撤销与失效：7 项通过")

  /* ---- 过期与越权 ---- */
  const expiredRow = await db.insert(schema.shares).values({
    id: id(), token: "expired-fixture-token-0123456789ab", ownerId, sourceProjectId: projectId,
    resourceType: "project", resourceId: projectId, snapshot: { schemaVersion: 1 },
    expiresAt: new Date(Date.now() - 1000),
  }).returning()
  await responseJson(
    await publicRoute.GET(apiRequest("/api/share/expired-fixture-token-0123456789ab"), routeContext("token", "expired-fixture-token-0123456789ab")),
    404
  )
  await db.delete(schema.shares).where(eq(schema.shares.id, expiredRow[0].id))

  const otherCreate = await sharesRoute.POST(
    apiRequest("/api/thread-chat/v1/shares", { method: "POST", cookie: otherCookie, body: { ...createBody, commandId: id() } })
  )
  await responseJson(otherCreate, 404)
  const otherRevoke = await shareIdRoute.DELETE(
    apiRequest(`/api/thread-chat/v1/shares/${createdShareId}`, { method: "DELETE", cookie: otherCookie }),
    routeContext("shareId", createdShareId)
  )
  await responseJson(otherRevoke, 404)
  console.log("过期与跨用户拒绝：3 项通过")

  /* ---- Document 分享 pin 当前版 ---- */
  const docCreated = await responseJson(
    await sharesRoute.POST(
      apiRequest("/api/thread-chat/v1/shares", {
        method: "POST", cookie: ownerCookie,
        body: { commandId: id(), resourceType: "document", documentId, expiresIn: "never" },
      })
    )
  )
  const docShare = docCreated.data.share
  const docPublic = await responseJson(
    await publicRoute.GET(apiRequest(`/api/share/${docShare.token}`), routeContext("token", docShare.token))
  )
  assert.equal(docPublic.snapshot.kind, "document")
  assert.equal(docPublic.snapshot.document.revisionId, revisionId)
  assert.equal(docPublic.snapshot.document.revisionNumber, 1)
  assert.equal(docPublic.snapshot.document.artifactId, artifactId)
  assert.ok(!docPublic.snapshot.content.includes("/api/attachments/"))
  assert.ok(!JSON.stringify(docPublic.snapshot).includes("sourceMessageId"))
  console.log("Document 快照 pin 当前版：6 项通过")

  /* ---- 级联：删除 Project 使分享失效（同应用层删除顺序） ---- */
  await db.update(schema.documents).set({ currentRevisionId: null }).where(eq(schema.documents.projectId, projectId))
  await db.delete(schema.documents).where(eq(schema.documents.projectId, projectId))
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId))
  const remaining = await db.select({ id: schema.shares.id }).from(schema.shares).where(eq(schema.shares.sourceProjectId, projectId))
  assert.equal(remaining.length, 0, "删除 Project 级联删除其分享")
  console.log("级联删除：1 项通过")

  console.log("snapshot-sharing PostgreSQL integration tests passed")
} finally {
  await db.update(schema.documents).set({ currentRevisionId: null }).where(eq(schema.documents.projectId, projectId))
  await db.delete(schema.documents).where(eq(schema.documents.projectId, projectId))
  await db.delete(schema.projects).where(eq(schema.projects.userId, ownerId))
  await db.delete(schema.user).where(eq(schema.user.id, ownerId))
  await db.delete(schema.user).where(eq(schema.user.id, otherId))
  await globalThis.__dbClient?.end()
}
