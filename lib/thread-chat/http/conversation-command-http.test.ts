import assert from "node:assert/strict"
import test from "node:test"

process.env.CONVERSATION_AUTHORITY = "canonical"
process.env.CONVERSATION_CUTOVER_EPOCH = "command-http-test"
process.env.CONVERSATION_ISOLATED_TEST = "true"

import {
  commandSuccessTransportSchema,
  conversationErrorTransportSchema,
  createConversationRequestSchema,
} from "../contracts/conversation-command-api.ts"
import {
  ConversationCommandError,
  type CommandSuccess,
} from "../application/conversation-command-contracts.ts"
import { projectId } from "../domain/conversation-model.ts"
import {
  commandEnvelope,
  commandResponse,
  parseJson,
  routeErrorResponse,
} from "./conversation-command-http.ts"

test("传输 schema 拒绝客户端伪造 owner 和未知字段", async () => {
  const request = new Request("http://localhost/api/projects/p/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: "conversation-1",
      rootThreadId: "thread-1",
      modelId: "glm-5.3",
      ownerId: "forged-owner",
    }),
  })
  await assert.rejects(
    () => parseJson(request, createConversationRequestSchema),
    (error: unknown) =>
      error instanceof ConversationCommandError &&
      error.code === "invalid_request"
  )
})

test("Header 映射要求幂等键，并解析 If-Match/command ID", () => {
  const actor = { kind: "user" as const, userId: "user-1" }
  const scope = { type: "project" as const, id: projectId("project-1") }
  assert.throws(
    () =>
      commandEnvelope({
        request: new Request("http://localhost"),
        actor,
        scope,
        payload: {},
      }),
    (error: unknown) =>
      error instanceof ConversationCommandError &&
      error.code === "invalid_request"
  )
  const envelope = commandEnvelope({
    request: new Request("http://localhost", {
      headers: {
        "Idempotency-Key": "stable-key",
        "If-Match": 'W/"7"',
        "X-Command-Id": "command-1",
      },
    }),
    actor,
    scope,
    payload: { title: "标题" },
    expectedRevisionRequired: true,
  })
  assert.equal(envelope.expectedRevision, 7)
  assert.equal(envelope.commandId, "command-1")
  assert.equal(envelope.idempotencyKey, "stable-key")
})

test("错误分类只把真实冲突映射为 409", async () => {
  const invalid = routeErrorResponse(
    new ConversationCommandError("invalid_request", "格式错误")
  )
  const version = routeErrorResponse(
    new ConversationCommandError("version_conflict", "版本冲突", {
      currentRevision: 3,
      retryable: true,
    })
  )
  const semantic = routeErrorResponse(
    new ConversationCommandError("semantic_validation", "语义错误")
  )
  assert.equal(invalid.status, 400)
  assert.equal(version.status, 409)
  assert.equal(semantic.status, 422)
  conversationErrorTransportSchema.parse(await version.json())
})

test("成功 envelope 按显式并发作用域返回 ETag", async () => {
  const result: CommandSuccess = {
    schemaVersion: 1,
    data: { conversationId: "conversation-1" },
    revisions: { "conversation-1": 2, "thread-1": 7, "turn-1": 0 },
    delta: { upsert: {}, remove: {}, invalidate: [] },
    replayed: false,
  }
  const response = commandResponse(result, "thread-1")
  assert.equal(response.headers.get("etag"), '"7"')
  commandSuccessTransportSchema.parse(await response.json())
})
