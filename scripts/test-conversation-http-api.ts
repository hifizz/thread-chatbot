import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { config } from "dotenv"
import { eq, inArray } from "drizzle-orm"

config({ path: ".env.local" })

const baseUrl = new URL(
  process.env.CONVERSATION_HTTP_TEST_BASE_URL || "http://localhost:4040"
)
const email =
  process.env.CONVERSATION_HTTP_TEST_EMAIL ||
  "codex.issue34.20260822@example.com"
const password = process.env.CONVERSATION_HTTP_TEST_PASSWORD
const realModel = process.argv.includes("--real-model")

if (!password)
  throw new Error(
    "缺少 CONVERSATION_HTTP_TEST_PASSWORD；请在 .env.local 配置邮箱测试账号密码。"
  )

const { db } = await import("../lib/db/index.ts")
const {
  conversationCommandRecords,
  conversationOutboxEvents,
  projects,
  usageRecords,
  user,
  workspaceMembers,
  workspaces,
} = await import("../lib/db/schema.ts")

const runId = randomUUID()
const prefix = `http-api-test:${runId}`
const workspaceId = `${prefix}:workspace`
const projectId = `${prefix}:project`
const conversationId = `${prefix}:conversation`
const rootThreadId = `${prefix}:thread:root`
const turnId = `${prefix}:turn:1`
const userMessageId = `${prefix}:message:user`
const assistantMessageId = `${prefix}:message:assistant`
const generationId = `${prefix}:generation`
const commandIds: string[] = []
const aggregateIds = [
  conversationId,
  rootThreadId,
  turnId,
  generationId,
]
let cookie = ""
let assertions = 0

type ApiResult = {
  response: Response
  body: unknown
}

async function api(
  path: string,
  input: {
    method?: string
    body?: unknown
    authenticated?: boolean
    headers?: Record<string, string>
  } = {}
): Promise<ApiResult> {
  const headers = new Headers(input.headers)
  headers.set("Origin", baseUrl.origin)
  if (input.authenticated !== false) headers.set("Cookie", cookie)
  if (input.body !== undefined) headers.set("Content-Type", "application/json")
  const response = await fetch(new URL(path, baseUrl), {
    method: input.method || "GET",
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    redirect: "manual",
  })
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { response, body }
}

function commandHeaders(
  suffix: string,
  expectedRevision?: number
): Record<string, string> {
  const commandId = `${prefix}:command:${suffix}`
  commandIds.push(commandId)
  return {
    "Idempotency-Key": `${prefix}:key:${suffix}`,
    "X-Command-Id": commandId,
    ...(expectedRevision === undefined
      ? {}
      : { "If-Match": `"${expectedRevision}"` }),
  }
}

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("error" in body)) return undefined
  const error = body.error
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function responseData(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object" || !("data" in body)) return undefined
  const data = body.data
  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : undefined
}

async function waitForGeneration(): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const result = await api(`/api/generations/${generationId}`)
    assert.equal(result.response.status, 200)
    const generation = responseData(result.body)?.generation
    assert.ok(generation && typeof generation === "object")
    const status = (generation as Record<string, unknown>).status
    if (
      status === "completed" ||
      status === "stopped" ||
      status === "failed" ||
      status === "superseded"
    )
      return generation as Record<string, unknown>
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error("等待 GLM 5.3 Generation 终态超时")
}

try {
  const authority = await api("/api/conversation-authority", {
    authenticated: false,
  })
  assert.equal(authority.response.status, 200)
  assert.equal(
    (authority.body as { authority?: unknown } | null)?.authority,
    "canonical"
  )
  assertions += 2

  const signIn = await api("/api/auth/sign-in/email", {
    method: "POST",
    authenticated: false,
    body: { email, password, rememberMe: false },
  })
  assert.equal(signIn.response.status, 200, JSON.stringify(signIn.body))
  const setCookies = signIn.response.headers.getSetCookie()
  cookie = setCookies
    .map((value) => value.slice(0, value.indexOf(";")))
    .filter(Boolean)
    .join("; ")
  assert.ok(cookie.includes("session_token"), "邮箱登录未返回 session cookie")
  assertions += 2

  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  assert.ok(owner)
  await db.insert(workspaces).values({
    id: workspaceId,
    revision: 0,
    lifecycle: "active",
  })
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: owner.id,
    role: "owner",
  })
  await db.insert(projects).values({
    id: projectId,
    workspaceId,
    title: "HTTP API 本地数据库测试",
    revision: 0,
    lifecycle: "active",
  })

  const unauthenticated = await api(`/api/projects/${projectId}/conversations`, {
    authenticated: false,
  })
  assert.equal(unauthenticated.response.status, 401)
  assert.equal(errorCode(unauthenticated.body), "unauthenticated")
  assertions += 2

  const createHeaders = commandHeaders("create")
  const createBody = {
    conversationId,
    rootThreadId,
    title: "HTTP API Conversation",
    modelId: "glm-5.3",
  }
  const created = await api(`/api/projects/${projectId}/conversations`, {
    method: "POST",
    headers: createHeaders,
    body: createBody,
  })
  assert.equal(created.response.status, 200, JSON.stringify(created.body))
  assert.equal(created.response.headers.get("etag"), '"0"')
  assert.equal(responseData(created.body)?.replayed, undefined)
  assert.equal((created.body as { replayed?: unknown }).replayed, false)
  assertions += 4

  const replayed = await api(`/api/projects/${projectId}/conversations`, {
    method: "POST",
    headers: createHeaders,
    body: createBody,
  })
  assert.equal(replayed.response.status, 200)
  assert.equal((replayed.body as { replayed?: unknown }).replayed, true)
  assertions += 2

  const idempotencyConflict = await api(
    `/api/projects/${projectId}/conversations`,
    {
      method: "POST",
      headers: createHeaders,
      body: { ...createBody, title: "同键不同载荷" },
    }
  )
  assert.equal(idempotencyConflict.response.status, 409)
  assert.equal(errorCode(idempotencyConflict.body), "idempotency_conflict")
  assertions += 2

  const snapshot = await api(`/api/conversations/${conversationId}`)
  assert.equal(snapshot.response.status, 200)
  assert.equal(snapshot.response.headers.get("etag"), '"0"')
  const snapshotData = responseData(snapshot.body)
  assert.equal(
    (snapshotData?.snapshot as { conversation?: { rootThreadId?: unknown } })
      ?.conversation?.rootThreadId,
    rootThreadId
  )
  assertions += 3

  const missingRevision = await api(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    headers: commandHeaders("rename-missing-revision"),
    body: { title: "缺少 If-Match" },
  })
  assert.equal(missingRevision.response.status, 400)
  assert.equal(errorCode(missingRevision.body), "invalid_request")
  assertions += 2

  const renamed = await api(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    headers: commandHeaders("rename", 0),
    body: { title: "HTTP API 已重命名" },
  })
  assert.equal(renamed.response.status, 200, JSON.stringify(renamed.body))
  assert.equal(renamed.response.headers.get("etag"), '"1"')
  assertions += 2

  if (realModel) {
    const sent = await api(`/api/threads/${rootThreadId}/turns`, {
      method: "POST",
      headers: commandHeaders("send", 0),
      body: {
        conversationId,
        turnId,
        userMessageId,
        assistantMessageId,
        generationId,
        content: {
          schemaVersion: 1,
          parts: [
            {
              type: "text",
              text: "只回复：HTTP API GLM 5.3 测试通过",
            },
          ],
        },
        modelId: "glm-5.3",
      },
    })
    assert.equal(sent.response.status, 200, JSON.stringify(sent.body))
    const generation = await waitForGeneration()
    assert.equal(generation.status, "completed", JSON.stringify(generation))
    assert.equal(generation.modelId, "glm-5.3")
    const checkpoint = generation.checkpoint as { body?: unknown } | undefined
    assert.match(String(checkpoint?.body || ""), /HTTP API GLM 5\.3 测试通过/)
    assertions += 4

    const feedback = await api(
      `/api/conversations/${conversationId}/messages/${assistantMessageId}/feedback`,
      {
        method: "PUT",
        body: { threadId: rootThreadId, feedback: "positive" },
      }
    )
    assert.equal(feedback.response.status, 200, JSON.stringify(feedback.body))
    const feedbackList = await api(
      `/api/conversations/${conversationId}/message-feedback`
    )
    assert.equal(feedbackList.response.status, 200)
    assert.equal(
      (feedbackList.body as { feedback?: Array<{ messageId?: unknown }> })
        .feedback?.[0]?.messageId,
      assistantMessageId
    )
    assertions += 3
  }

  const deleted = await api(`/api/conversations/${conversationId}`, {
    method: "DELETE",
    headers: commandHeaders("delete", 1),
  })
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body))
  const missing = await api(`/api/conversations/${conversationId}`)
  assert.equal(missing.response.status, 404)
  assert.equal(errorCode(missing.body), "not_found")
  assertions += 3

  console.log(
    JSON.stringify({
      ok: true,
      assertions,
      transport: "HTTP",
      database: "local-postgresql",
      authentication: "email-password",
      model: realModel ? "glm-5.3" : "not-invoked",
    })
  )
} finally {
  if (cookie)
    await api("/api/auth/sign-out", { method: "POST" }).catch(() => undefined)
  await db
    .delete(conversationOutboxEvents)
    .where(inArray(conversationOutboxEvents.aggregateId, aggregateIds))
  if (commandIds.length > 0)
    await db
      .delete(conversationCommandRecords)
      .where(inArray(conversationCommandRecords.id, commandIds))
  await db
    .delete(usageRecords)
    .where(eq(usageRecords.appGenerationId, generationId))
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
  await globalThis.__dbClient?.end({ timeout: 5 })
}
