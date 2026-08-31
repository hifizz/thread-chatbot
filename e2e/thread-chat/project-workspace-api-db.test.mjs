import assert from "node:assert/strict"
import { config } from "dotenv"

config({ path: ".env.local" })
const source = process.env.DIRECT_URL || process.env.DATABASE_URL
assert.ok(source, "测试需要 DIRECT_URL 或 DATABASE_URL")
assert.ok(process.env.BETTER_AUTH_SECRET, "测试需要 BETTER_AUTH_SECRET")
const testUrl = new URL(source.trim().replace(/^(['"])(.*)\1$/, "$2"))
testUrl.pathname = "/thread-chat-normalized-test"
testUrl.searchParams.set("options", "-c search_path=thread_chat,public,extensions")
process.env.DATABASE_URL = testUrl.toString()
process.env.DIRECT_URL = testUrl.toString()

const [
  { and, eq },
  { makeSignature },
  { auth },
  { db },
  schema,
  application,
  constants,
  streaming,
  projectRoute,
  fileRoute,
  fileItemRoute,
  artifactRoute,
  sendRoute,
] = await Promise.all([
  import("drizzle-orm"),
  import("better-auth/crypto"),
  import("../../lib/auth/index.ts"),
  import("../../lib/db/index.ts"),
  import("../../lib/db/schema.ts"),
  import("../../lib/thread-chat/application/index.ts"),
  import("../../constants/model.ts"),
  import("../../lib/thread-chat/streaming/index.ts"),
  import("../../app/api/thread-chat/v1/projects/[projectId]/route.ts"),
  import("../../app/api/thread-chat/v1/projects/[projectId]/files/route.ts"),
  import("../../app/api/thread-chat/v1/projects/[projectId]/files/[attachmentId]/route.ts"),
  import("../../app/api/thread-chat/v1/artifacts/[artifactId]/route.ts"),
  import("../../app/api/thread-chat/v1/threads/[threadId]/messages/route.ts"),
])

const id = () => crypto.randomUUID()
const prefix = `project-workspace-api-${id()}`
const ownerId = `${prefix}-owner`
const otherId = `${prefix}-other`
const ownerToken = `${prefix}-owner-token`
const otherToken = `${prefix}-other-token`
const modelId = constants.DEFAULT_THREAD_CHAT_MODEL_ID

function context(values) {
  return { params: Promise.resolve(values) }
}

function request(path, { method = "GET", cookie, body } = {}) {
  const headers = new Headers()
  if (cookie) headers.set("cookie", cookie)
  if (body !== undefined) headers.set("content-type", "application/json")
  return new Request(`http://thread-chat.test${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text())
  return response.json()
}

async function createUserSession(userId, token, suffix) {
  const now = new Date()
  await db.insert(schema.user).values({
    id: userId,
    name: `Workspace API ${suffix}`,
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

async function cookie(token) {
  const signature = await makeSignature(token, process.env.BETTER_AUTH_SECRET)
  const authContext = await auth.$context
  return `${authContext.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`
}

async function createProject(ownerIdValue, projectId, rootThreadId) {
  return application.startProject(ownerIdValue, {
    commandId: id(),
    projectId,
    rootThreadId,
    userMessageId: id(),
    assistantMessageId: id(),
    modelId,
    text: "Workspace API seed",
    files: [],
  })
}

try {
  await createUserSession(ownerId, ownerToken, "owner")
  await createUserSession(otherId, otherToken, "other")
  const ownerCookie = await cookie(ownerToken)
  const otherCookie = await cookie(otherToken)

  const projectId = id()
  const rootThreadId = id()
  const seeded = await createProject(ownerId, projectId, rootThreadId)
  const sourceMessageId = seeded.result.assistantMessage.id

  const contract = await json(
    await projectRoute.PATCH(
      request(`/api/thread-chat/v1/projects/${projectId}`, {
        method: "PATCH",
        cookie: ownerCookie,
        body: {
          commandId: id(),
          expectedContractVersion: 0,
          target: "API target",
          instructions: "API instructions",
        },
      }),
      context({ projectId })
    )
  )
  assert.equal(contract.data.contractVersion, 1)

  const attachmentId = id()
  await db.insert(schema.attachments).values({
    id: attachmentId,
    userId: ownerId,
    key: `${prefix}/${attachmentId}.pdf`,
    filename: "workspace.pdf",
    mimeType: "application/pdf",
    size: 128,
    kind: "document",
    status: "ready",
    pageCount: 1,
    pages: ["Workspace evidence"],
  })
  const addedFile = await json(
    await fileRoute.POST(
      request(`/api/thread-chat/v1/projects/${projectId}/files`, {
        method: "POST",
        cookie: ownerCookie,
        body: { commandId: id(), attachmentId },
      }),
      context({ projectId })
    )
  )
  assert.equal(addedFile.data.attachmentId, attachmentId)

  const artifactId = id()
  await db.insert(schema.artifacts).values({
    id: artifactId,
    projectId,
    threadId: rootThreadId,
    sourceMessageId,
    kind: "markdown",
    title: "Workspace Artifact",
    content: "# Workspace Artifact",
    metadata: {},
  })

  const bootstrapResponse = await projectRoute.GET(
    request(`/api/thread-chat/v1/projects/${projectId}`, { cookie: ownerCookie }),
    context({ projectId })
  )
  assert.equal(bootstrapResponse.headers.get("cache-control"), "private, no-store, max-age=0")
  const bootstrap = await json(bootstrapResponse)
  assert.equal(bootstrap.project.target, "API target")
  assert.equal(bootstrap.project.instructions, "API instructions")
  assert.equal(bootstrap.files.length, 1)
  assert.equal(bootstrap.files[0].attachmentId, attachmentId)
  assert.equal(bootstrap.artifacts.length, 1)
  assert.equal(bootstrap.artifacts[0].id, artifactId)
  assert.equal(bootstrap.artifacts[0].threadId, rootThreadId)
  assert.equal(bootstrap.artifacts[0].sourceMessageId, sourceMessageId)
  assert.ok("sourceMessageStatus" in bootstrap.artifacts[0])

  // Cross-user Project/Artifact resources share the same 404 boundary.
  await json(
    await projectRoute.GET(
      request(`/api/thread-chat/v1/projects/${projectId}`, { cookie: otherCookie }),
      context({ projectId })
    ),
    404
  )
  await json(
    await artifactRoute.GET(
      request(`/api/thread-chat/v1/artifacts/${artifactId}`, { cookie: otherCookie }),
      context({ artifactId })
    ),
    404
  )
  await json(
    await fileRoute.POST(
      request(`/api/thread-chat/v1/projects/${projectId}/files`, {
        method: "POST",
        cookie: otherCookie,
        body: { commandId: id(), attachmentId },
      }),
      context({ projectId })
    ),
    404
  )

  // A Project File addressed under the wrong Project is hidden as Not Found.
  const secondProjectId = id()
  await createProject(ownerId, secondProjectId, id())
  await json(
    await fileItemRoute.DELETE(
      request(`/api/thread-chat/v1/projects/${secondProjectId}/files/${attachmentId}`, {
        method: "DELETE",
        cookie: ownerCookie,
        body: { commandId: id(), attachmentId },
      }),
      context({ projectId: secondProjectId, attachmentId })
    ),
    404
  )

  // Invalid foreign Thread must fail before any paid generation/session starts.
  const foreignProjectId = id()
  const foreignThreadId = id()
  await createProject(otherId, foreignProjectId, foreignThreadId)
  const blockedAssistantId = id()
  streaming.getSessionStore().sessions.delete(blockedAssistantId)
  await json(
    await sendRoute.POST(
      request(`/api/thread-chat/v1/threads/${foreignThreadId}/messages`, {
        method: "POST",
        cookie: ownerCookie,
        body: {
          commandId: id(),
          userMessageId: id(),
          assistantMessageId: blockedAssistantId,
          modelId,
          text: "must be rejected",
          files: [],
        },
      }),
      context({ threadId: foreignThreadId })
    ),
    404
  )
  assert.equal(
    streaming.getSessionStore().sessions.has(blockedAssistantId),
    false,
    "非法资源必须在启动 Generation Session 前被拒绝"
  )

  console.log("project workspace API integration tests passed")
} finally {
  await db.delete(schema.user).where(and(eq(schema.user.id, ownerId)))
  await db.delete(schema.user).where(and(eq(schema.user.id, otherId)))
  await globalThis.__dbClient?.end()
}
