import assert from "node:assert/strict"
import test from "node:test"

import { buildThreadChatSearchPolicy } from "../../lib/chat/thread-chat-search-policy.ts"

test("搜索政策使用服务端日期、时区与模式", () => {
  const policy = buildThreadChatSearchPolicy({
    enabled: true,
    mode: "auto",
    now: new Date("2026-08-05T03:04:05.000Z"),
    timeZone: "Asia/Singapore",
  })

  assert.match(policy, /2026-08-05T03:04:05\.000Z/)
  assert.match(policy, /Asia\/Singapore/)
  assert.match(policy, /本轮 Web Search 模式为 auto/)
  assert.match(policy, /版本\/依赖\/API\/安全公告/)
  assert.match(policy, /不可信外部数据/)
  assert.match(policy, /只能引用本轮工具实际返回/)
})

test("搜索不可用时明确禁止伪造核验与来源", () => {
  const policy = buildThreadChatSearchPolicy({
    enabled: false,
    mode: "always",
    now: new Date("2026-08-05T00:00:00.000Z"),
    timeZone: "UTC",
  })

  assert.match(policy, /用户要求本轮必须联网，但 Web Search 当前不可用/)
  assert.match(policy, /不得编造搜索或来源/)
})

test("always 首搜完成后要求复用证据而非重复搜索", () => {
  const policy = buildThreadChatSearchPolicy({
    enabled: true,
    mode: "always",
    forcedSearchCompleted: true,
    now: new Date("2026-08-05T00:00:00.000Z"),
    timeZone: "UTC",
  })

  assert.match(policy, /唯一一次搜索已经完成/)
  assert.match(policy, /本轮不会再提供搜索工具/)
})
