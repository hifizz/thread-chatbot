import assert from "node:assert/strict"
import { config } from "dotenv"

config({ path: ".env.local" })

const source = process.env.DIRECT_URL || process.env.DATABASE_URL
assert.ok(source, "测试需要 DIRECT_URL 或 DATABASE_URL")
assert.ok(process.env.BETTER_AUTH_SECRET, "测试需要 BETTER_AUTH_SECRET")

const testUrl = new URL(source.trim().replace(/^(['"])(.*)\1$/, "$2"))
testUrl.pathname = "/thread-chat-normalized-test"
testUrl.searchParams.set(
  "options",
  "-c search_path=thread_chat,public,extensions"
)
process.env.DATABASE_URL = testUrl.toString()
process.env.DIRECT_URL = testUrl.toString()

const [
  { eq },
  { makeSignature },
  { auth },
  { db },
  schema,
  constants,
  streaming,
  artifactSupport,
  projectRoutes,
  projectRoute,
  startRoute,
  threadRoute,
  sendRoute,
  forkRoute,
  messageRoute,
  streamRoute,
  stopRoute,
  retryRoute,
  editRoute,
  feedbackRoute,
  artifactRoute,
] = await Promise.all([
  import("drizzle-orm"),
  import("better-auth/crypto"),
  import("../../lib/auth/index.ts"),
  import("../../lib/db/index.ts"),
  import("../../lib/db/schema.ts"),
  import("../../constants/model.ts"),
  import("../../lib/thread-chat/streaming/index.ts"),
  import("../../lib/thread-chat/streaming/artifacts.ts"),
  import("../../app/api/thread-chat/v1/projects/route.ts"),
  import("../../app/api/thread-chat/v1/projects/[projectId]/route.ts"),
  import("../../app/api/thread-chat/v1/projects/[projectId]/start/route.ts"),
  import("../../app/api/thread-chat/v1/threads/[threadId]/route.ts"),
  import("../../app/api/thread-chat/v1/threads/[threadId]/messages/route.ts"),
  import("../../app/api/thread-chat/v1/threads/[threadId]/forks/route.ts"),
  import("../../app/api/thread-chat/v1/messages/[messageId]/route.ts"),
  import("../../app/api/thread-chat/v1/messages/[messageId]/stream/route.ts"),
  import("../../app/api/thread-chat/v1/messages/[messageId]/stop/route.ts"),
  import("../../app/api/thread-chat/v1/messages/[messageId]/retry/route.ts"),
  import("../../app/api/thread-chat/v1/messages/[messageId]/edit/route.ts"),
  import("../../app/api/thread-chat/v1/messages/[messageId]/feedback/route.ts"),
  import("../../app/api/thread-chat/v1/artifacts/[artifactId]/route.ts"),
])

const id = () => crypto.randomUUID()
const prefix = `gate2-api-${id()}`
const ownerId = `${prefix}-owner`
const otherId = `${prefix}-other`
const ownerSessionToken = `${prefix}-owner-session`
const otherSessionToken = `${prefix}-other-session`
const modelId = constants.DEFAULT_THREAD_CHAT_MODEL_ID
const store = streaming.getSessionStore()
const originalStart = store.start.bind(store)
const generationModes = new Map()
const startCounts = new Map()

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
    name: `Gate 2 API ${suffix}`,
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

function completedSnapshot(input, includeArtifact) {
  const toolCallId = `artifact-${input.messageId}`
  return {
    id: input.messageId,
    role: "assistant",
    metadata: {
      messageId: input.messageId,
      threadId: input.initialSnapshot.metadata.threadId,
      modelId,
    },
    parts: [
      ...(includeArtifact
        ? [
            {
              type: "tool-createMarkdownArtifact",
              toolCallId,
              state: "output-available",
              input: {
                title: "Gate 2 API Artifact",
                content: "# Route Handler + PostgreSQL",
              },
              output: {
                created: true,
                artifactId: artifactSupport.artifactIdForTool(
                  input.messageId,
                  toolCallId
                ),
              },
            },
          ]
        : []),
      { type: "text", text: `fake answer ${input.messageId}`, state: "done" },
    ],
  }
}

store.sessions.clear()
store.start = (input) => {
  startCounts.set(input.messageId, (startCounts.get(input.messageId) ?? 0) + 1)
  const mode = generationModes.get(input.messageId) ?? {
    holdUntilAbort: false,
    includeArtifact: false,
  }
  return originalStart({
    ...input,
    run: async (sessionController) => {
      if (mode.holdUntilAbort && !sessionController.signal.aborted) {
        await new Promise((resolve) =>
          sessionController.signal.addEventListener("abort", resolve, {
            once: true,
          })
        )
      }
      const snapshot = completedSnapshot(input, mode.includeArtifact)
      const terminal = await streaming.finalizeGeneration({
        messageId: input.messageId,
        snapshot,
        status: sessionController.signal.aborted ? "stopped" : "completed",
        finishReason: sessionController.signal.aborted ? "abort" : "stop",
        providerUsage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          source: "controlled-api-integration",
        },
      })
      sessionController.finish(terminal, snapshot)
    },
  })
}

let ownerCookie
let otherCookie

try {
  // 第一次请求先触发 runtime sweep；没有 cookie 必须停在认证层。
  const unauthorized = await projectRoutes.GET(
    apiRequest("/api/thread-chat/v1/projects")
  )
  await responseJson(unauthorized, 401)

  await createUserAndSession(ownerId, ownerSessionToken, "owner")
  await createUserAndSession(otherId, otherSessionToken, "other")
  ownerCookie = await sessionCookie(ownerSessionToken)
  otherCookie = await sessionCookie(otherSessionToken)

  const projectId = id()
  const rootThreadId = id()
  const firstUserId = id()
  const firstAssistantId = id()
  const startCommand = {
    commandId: id(),
    projectId,
    rootThreadId,
    userMessageId: firstUserId,
    assistantMessageId: firstAssistantId,
    modelId,
    text: "通过真实 API 创建项目",
    files: [],
  }
  generationModes.set(firstAssistantId, {
    holdUntilAbort: false,
    includeArtifact: true,
  })

  const startedResponse = await startRoute.POST(
    apiRequest(`/api/thread-chat/v1/projects/${projectId}/start`, {
      method: "POST",
      cookie: ownerCookie,
      body: startCommand,
    }),
    routeContext("projectId", projectId)
  )
  assert.equal(
    startedResponse.headers.get("cache-control"),
    "private, no-store, max-age=0"
  )
  const started = await responseJson(startedResponse)
  assert.equal(started.ok, true)
  assert.equal(started.replayed, false)
  assert.equal(started.data.assistantMessage.id, firstAssistantId)
  await store.get(firstAssistantId).task
  assert.equal(startCounts.get(firstAssistantId), 1)

  const replayedStart = await responseJson(
    await startRoute.POST(
      apiRequest(`/api/thread-chat/v1/projects/${projectId}/start`, {
        method: "POST",
        cookie: ownerCookie,
        body: startCommand,
      }),
      routeContext("projectId", projectId)
    )
  )
  assert.equal(replayedStart.replayed, true)
  assert.equal(replayedStart.data.assistantMessage.id, firstAssistantId)
  assert.equal(startCounts.get(firstAssistantId), 1)

  const beforeInvalid = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(eq(schema.messages.projectId, projectId))
  const invalidResponse = await startRoute.POST(
    apiRequest(`/api/thread-chat/v1/projects/${projectId}/start`, {
      method: "POST",
      cookie: ownerCookie,
      body: { ...startCommand, commandId: id(), unknownField: true },
    }),
    routeContext("projectId", projectId)
  )
  await responseJson(invalidResponse, 400)
  const afterInvalid = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(eq(schema.messages.projectId, projectId))
  assert.equal(afterInvalid.length, beforeInvalid.length)

  const bootstrap = await responseJson(
    await projectRoute.GET(
      apiRequest(`/api/thread-chat/v1/projects/${projectId}`, {
        cookie: ownerCookie,
      }),
      routeContext("projectId", projectId)
    )
  )
  assert.equal(bootstrap.project.id, projectId)
  assert.equal(bootstrap.messages.length, 2)
  assert.equal(
    bootstrap.messages.find((message) => message.id === firstAssistantId)
      .status,
    "completed"
  )
  assert.equal(bootstrap.artifacts.length, 1)

  const polled = await responseJson(
    await messageRoute.GET(
      apiRequest(`/api/thread-chat/v1/messages/${firstAssistantId}`, {
        cookie: ownerCookie,
      }),
      routeContext("messageId", firstAssistantId)
    )
  )
  assert.equal(polled.status, "completed")
  assert(
    polled.parts.some((part) => part.type === "tool-createMarkdownArtifact")
  )

  const terminalStream = await streamRoute.GET(
    apiRequest(`/api/thread-chat/v1/messages/${firstAssistantId}/stream`, {
      cookie: ownerCookie,
    }),
    routeContext("messageId", firstAssistantId)
  )
  assert.equal(terminalStream.status, 200)
  assert.equal(
    terminalStream.headers.get("content-type"),
    "text/event-stream; charset=utf-8"
  )
  assert.equal(terminalStream.headers.get("x-accel-buffering"), "no")
  const terminalEvents = (await terminalStream.text())
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data: /, "")))
  assert.deepEqual(
    terminalEvents.map((event) => event.type),
    ["snapshot", "terminal"]
  )

  const artifact = bootstrap.artifacts[0]
  const fetchedArtifact = await responseJson(
    await artifactRoute.GET(
      apiRequest(`/api/thread-chat/v1/artifacts/${artifact.id}`, {
        cookie: ownerCookie,
      }),
      routeContext("artifactId", artifact.id)
    )
  )
  assert.equal(fetchedArtifact.sourceMessageId, firstAssistantId)
  assert.equal(fetchedArtifact.content, "# Route Handler + PostgreSQL")

  const hiddenFromOtherOwner = await artifactRoute.GET(
    apiRequest(`/api/thread-chat/v1/artifacts/${artifact.id}`, {
      cookie: otherCookie,
    }),
    routeContext("artifactId", artifact.id)
  )
  await responseJson(hiddenFromOtherOwner, 404)

  const feedback = await responseJson(
    await feedbackRoute.PUT(
      apiRequest(`/api/thread-chat/v1/messages/${firstAssistantId}/feedback`, {
        method: "PUT",
        cookie: ownerCookie,
        body: { commandId: id(), feedback: "up" },
      }),
      routeContext("messageId", firstAssistantId)
    )
  )
  assert.equal(feedback.data.feedback, "up")

  const renamed = await responseJson(
    await projectRoute.PATCH(
      apiRequest(`/api/thread-chat/v1/projects/${projectId}`, {
        method: "PATCH",
        cookie: ownerCookie,
        body: { commandId: id(), customTitle: "API 集成测试" },
      }),
      routeContext("projectId", projectId)
    )
  )
  assert.equal(renamed.data.customTitle, "API 集成测试")

  const updatedThread = await responseJson(
    await threadRoute.PATCH(
      apiRequest(`/api/thread-chat/v1/threads/${rootThreadId}`, {
        method: "PATCH",
        cookie: ownerCookie,
        body: { commandId: id(), customTitle: "根线程" },
      }),
      routeContext("threadId", rootThreadId)
    )
  )
  assert.equal(updatedThread.data.customTitle, "根线程")

  const secondUserId = id()
  const secondAssistantId = id()
  const sendCommand = {
    commandId: id(),
    userMessageId: secondUserId,
    assistantMessageId: secondAssistantId,
    modelId,
    text: "等待 Stop",
    files: [],
  }
  generationModes.set(secondAssistantId, {
    holdUntilAbort: true,
    includeArtifact: false,
  })
  const sent = await responseJson(
    await sendRoute.POST(
      apiRequest(`/api/thread-chat/v1/threads/${rootThreadId}/messages`, {
        method: "POST",
        cookie: ownerCookie,
        body: sendCommand,
      }),
      routeContext("threadId", rootThreadId)
    )
  )
  assert.equal(sent.data.assistantMessage.status, "generating")

  const replayedSend = await responseJson(
    await sendRoute.POST(
      apiRequest(`/api/thread-chat/v1/threads/${rootThreadId}/messages`, {
        method: "POST",
        cookie: ownerCookie,
        body: sendCommand,
      }),
      routeContext("threadId", rootThreadId)
    )
  )
  assert.equal(replayedSend.replayed, true)
  assert.equal(startCounts.get(secondAssistantId), 1)

  const liveStream = await streamRoute.GET(
    apiRequest(`/api/thread-chat/v1/messages/${secondAssistantId}/stream`, {
      cookie: ownerCookie,
    }),
    routeContext("messageId", secondAssistantId)
  )
  assert.equal(liveStream.status, 200)
  await liveStream.body.cancel()
  assert.equal(
    store.get(secondAssistantId).abortController.signal.aborted,
    false
  )

  const generatingPoll = await responseJson(
    await messageRoute.GET(
      apiRequest(`/api/thread-chat/v1/messages/${secondAssistantId}`, {
        cookie: ownerCookie,
      }),
      routeContext("messageId", secondAssistantId)
    )
  )
  assert.equal(generatingPoll.status, "generating")

  const stoppedResponse = await responseJson(
    await stopRoute.POST(
      apiRequest(`/api/thread-chat/v1/messages/${secondAssistantId}/stop`, {
        method: "POST",
        cookie: ownerCookie,
        body: { commandId: id() },
      }),
      routeContext("messageId", secondAssistantId)
    )
  )
  assert.equal(stoppedResponse.data.status, "generating")
  await store.get(secondAssistantId).task
  const stoppedPoll = await responseJson(
    await messageRoute.GET(
      apiRequest(`/api/thread-chat/v1/messages/${secondAssistantId}`, {
        cookie: ownerCookie,
      }),
      routeContext("messageId", secondAssistantId)
    )
  )
  assert.equal(stoppedPoll.status, "stopped")

  const replacementId = id()
  const retryCommand = {
    commandId: id(),
    assistantMessageId: replacementId,
    modelId,
  }
  const retried = await responseJson(
    await retryRoute.POST(
      apiRequest(`/api/thread-chat/v1/messages/${secondAssistantId}/retry`, {
        method: "POST",
        cookie: ownerCookie,
        body: retryCommand,
      }),
      routeContext("messageId", secondAssistantId)
    )
  )
  assert.equal(retried.data.assistantMessage.id, replacementId)
  await store.get(replacementId).task
  const replayedRetry = await responseJson(
    await retryRoute.POST(
      apiRequest(`/api/thread-chat/v1/messages/${secondAssistantId}/retry`, {
        method: "POST",
        cookie: ownerCookie,
        body: retryCommand,
      }),
      routeContext("messageId", secondAssistantId)
    )
  )
  assert.equal(replayedRetry.replayed, true)
  assert.equal(startCounts.get(replacementId), 1)

  const sourceAfterRetry = await responseJson(
    await messageRoute.GET(
      apiRequest(`/api/thread-chat/v1/messages/${secondAssistantId}`, {
        cookie: ownerCookie,
      }),
      routeContext("messageId", secondAssistantId)
    )
  )
  assert.equal(sourceAfterRetry.status, "stopped")
  assert.ok(sourceAfterRetry.supersededAt)

  const editedUserId = id()
  const editedAssistantId = id()
  const edited = await responseJson(
    await editRoute.POST(
      apiRequest(`/api/thread-chat/v1/messages/${secondUserId}/edit`, {
        method: "POST",
        cookie: ownerCookie,
        body: {
          commandId: id(),
          userMessageId: editedUserId,
          assistantMessageId: editedAssistantId,
          modelId,
          text: "编辑后的最新一轮",
          files: [],
        },
      }),
      routeContext("messageId", secondUserId)
    )
  )
  assert.equal(edited.data.generation.userMessage.id, editedUserId)
  await store.get(editedAssistantId).task

  const childThreadId = id()
  const forkCommand = {
    commandId: id(),
    threadId: childThreadId,
    sourceMessageId: editedAssistantId,
    anchorText: "fake",
    anchor: { quote: { exact: "fake", prefix: "", suffix: "" } },
    modelId,
  }
  const forked = await responseJson(
    await forkRoute.POST(
      apiRequest(`/api/thread-chat/v1/threads/${rootThreadId}/forks`, {
        method: "POST",
        cookie: ownerCookie,
        body: forkCommand,
      }),
      routeContext("threadId", rootThreadId)
    )
  )
  assert.equal(forked.data.thread.id, childThreadId)
  assert.equal(forked.data.thread.forkMessageId, editedAssistantId)

  const projectList = await responseJson(
    await projectRoutes.GET(
      apiRequest("/api/thread-chat/v1/projects?archived=false", {
        cookie: ownerCookie,
      })
    )
  )
  const listedProject = projectList.find((project) => project.id === projectId)
  assert(listedProject)
  assert.deepEqual(Object.keys(listedProject).sort(), [
    "id",
    "threadCount",
    "title",
    "updatedAt",
  ])
  assert.equal(listedProject.title, "根线程")
  assert.equal(listedProject.threadCount, 2)

  const [projectRow] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
  const messageRows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.projectId, projectId))
  const commandRows = await db
    .select()
    .from(schema.conversationCommands)
    .where(eq(schema.conversationCommands.userId, ownerId))
  assert.equal(projectRow.customTitle, "根线程")
  assert.equal(messageRows.length, 7)
  assert.equal(commandRows.length, 9)

  const deleted = await responseJson(
    await projectRoute.DELETE(
      apiRequest(`/api/thread-chat/v1/projects/${projectId}`, {
        method: "DELETE",
        cookie: ownerCookie,
        body: { commandId: id() },
      }),
      routeContext("projectId", projectId)
    )
  )
  assert.equal(deleted.data.deleted, true)
  const remaining = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
  assert.equal(remaining.length, 0)
  const remainingMessages = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(eq(schema.messages.projectId, projectId))
  const remainingArtifacts = await db
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(eq(schema.artifacts.projectId, projectId))
  assert.equal(remainingMessages.length, 0)
  assert.equal(remainingArtifacts.length, 0)

  console.log(
    "normalized v1 Route Handler + PostgreSQL integration tests passed"
  )
} finally {
  for (const session of store.sessions.values()) {
    if (session.status === "running")
      session.abortController.abort("test-cleanup")
  }
  await Promise.all(
    [...store.sessions.values()].map((session) => session.task).filter(Boolean)
  )
  store.sessions.clear()
  store.start = originalStart
  await db.delete(schema.user).where(eq(schema.user.id, ownerId))
  await db.delete(schema.user).where(eq(schema.user.id, otherId))
  await globalThis.__dbClient?.end()
}
