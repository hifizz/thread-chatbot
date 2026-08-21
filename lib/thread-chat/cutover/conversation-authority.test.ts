import assert from "node:assert/strict"
import test from "node:test"

import {
  legacyProtocolGate,
  resolveConversationAuthority,
} from "./conversation-authority.ts"

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

test("legacy 与 canonical 都只能解析为一个完整部署状态", () => {
  assert.equal(
    resolveConversationAuthority({ CONVERSATION_AUTHORITY: "legacy" })
      .authority,
    "legacy"
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

test("legacy gate 在 canonical 返回 410，在维护窗口只拒绝会产生新业务事实的 mutation", async () => {
  const canonical = legacyProtocolGate(
    { mutation: false },
    {
      CONVERSATION_AUTHORITY: "canonical",
      CONVERSATION_CUTOVER_EPOCH: "epoch-1",
    }
  )
  assert.equal(canonical?.status, 410)
  assert.equal((await canonical?.json()).error.code, "legacy_protocol_retired")
  assert.equal(
    legacyProtocolGate(
      { mutation: false },
      {
        CONVERSATION_AUTHORITY: "legacy",
        CONVERSATION_MAINTENANCE_MODE: "read-only",
      }
    ),
    null
  )
  // 查询与 Stop/排空均使用 mutation=false；切 canonical 后同样会得到上面的 410。
  assert.equal(
    legacyProtocolGate(
      { mutation: true },
      {
        CONVERSATION_AUTHORITY: "legacy",
        CONVERSATION_MAINTENANCE_MODE: "read-only",
      }
    )?.status,
    503
  )
})
