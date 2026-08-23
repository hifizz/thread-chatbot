import assert from "node:assert/strict"
import test from "node:test"

import { resolveConversationAuthority } from "./conversation-authority.ts"

test("authority 缺失、未知和遗留分裂配置均启动失败", () => {
  assert.throws(() => resolveConversationAuthority({}))
  assert.throws(() =>
    resolveConversationAuthority({ CONVERSATION_AUTHORITY: "mixed" })
  )
  assert.throws(() =>
    resolveConversationAuthority({
      CONVERSATION_AUTHORITY: "canonical",
      CONVERSATION_CUTOVER_EPOCH: "epoch-1",
      CONVERSATION_CLIENT_AUTHORITY: "canonical",
    })
  )
  assert.throws(() =>
    resolveConversationAuthority({
      CONVERSATION_AUTHORITY: "canonical",
      CONVERSATION_CUTOVER_EPOCH: "epoch-1",
      CONVERSATION_PERSISTENCE_WRITE_MODE: "canonical",
    })
  )
})

test("canonical 必须携带 epoch，且生产不能使用 isolated test", () => {
  assert.throws(() =>
    resolveConversationAuthority({ CONVERSATION_AUTHORITY: "canonical" })
  )
  assert.throws(() =>
    resolveConversationAuthority({
      NODE_ENV: "production",
      CONVERSATION_AUTHORITY: "canonical",
      CONVERSATION_CUTOVER_EPOCH: "epoch-1",
      CONVERSATION_ISOLATED_TEST: "true",
    })
  )
  assert.deepEqual(
    resolveConversationAuthority({
      NODE_ENV: "test",
      CONVERSATION_AUTHORITY: "canonical",
      CONVERSATION_CUTOVER_EPOCH: "epoch-1",
      CONVERSATION_ISOLATED_TEST: "true",
    }),
    {
      authority: "canonical",
      schemaVersion: 1,
      epoch: "epoch-1",
      maintenanceMode: "off",
      isolatedTest: true,
    }
  )
})

test("cutover 后 legacy 配置失败，canonical 仍支持受控只读维护", () => {
  assert.throws(() =>
    resolveConversationAuthority({ CONVERSATION_AUTHORITY: "legacy" })
  )
  assert.equal(
    resolveConversationAuthority({
      CONVERSATION_AUTHORITY: "canonical",
      CONVERSATION_CUTOVER_EPOCH: "2026-08-22T00",
      CONVERSATION_MAINTENANCE_MODE: "read-only",
    }).maintenanceMode,
    "read-only"
  )
})
