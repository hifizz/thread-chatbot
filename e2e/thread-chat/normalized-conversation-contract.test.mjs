import assert from "node:assert/strict"
import {
  deleteProjectCommandSchema,
  sendMessageCommandSchema,
} from "../../lib/thread-chat/contracts/commands.ts"
import {
  canonicalCommandPayload,
  hasSameCommandSemantics,
} from "../../lib/thread-chat/contracts/command-replay.ts"
import { buildFrozenForkContext } from "../../lib/thread-chat/domain/fork-context.ts"
import { isRootThread } from "../../lib/thread-chat/domain/root-thread.ts"
import {
  resolveFinalStatus,
  softSupersedeMessage,
} from "../../lib/thread-chat/domain/state-machine.ts"
import {
  canEditLatestUserTurn,
  canRetryLatestAssistant,
  currentTimeline,
  findMessageIncludingSuperseded,
} from "../../lib/thread-chat/domain/timeline.ts"

const ids = {
  command: "10000000-0000-4000-8000-000000000001",
  user: "10000000-0000-4000-8000-000000000002",
  assistantA: "10000000-0000-4000-8000-000000000003",
  assistantB: "10000000-0000-4000-8000-000000000004",
  assistantC: "10000000-0000-4000-8000-000000000005",
  thread: "10000000-0000-4000-8000-000000000006",
}

function message({
  id,
  sequence,
  role,
  status,
  replacesMessageId = null,
  supersededAt = null,
  text = "",
}) {
  return {
    id,
    threadId: ids.thread,
    sequence,
    role,
    parts: [{ type: "text", text }],
    status,
    replacesMessageId,
    supersededAt,
  }
}

const user = message({
  id: ids.user,
  sequence: 1,
  role: "user",
  status: "completed",
  text: "question",
})
const assistantA = message({
  id: ids.assistantA,
  sequence: 2,
  role: "assistant",
  status: "failed",
  text: "partial A",
})

assert.equal(resolveFinalStatus("generating", "completed"), "completed")
assert.equal(
  resolveFinalStatus("failed", "completed"),
  "failed",
  "终态不得被迟到的完成回调改写"
)
assert.equal(canRetryLatestAssistant([user, assistantA], ids.assistantA), true)

const failedAContent = assistantA.parts
const supersededA = softSupersedeMessage(
  assistantA,
  "2026-08-26T00:00:00.000Z"
)
assert.equal(supersededA.status, "failed")
assert.equal(supersededA.parts, failedAContent)

const assistantB = message({
  id: ids.assistantB,
  sequence: 3,
  role: "assistant",
  status: "failed",
  replacesMessageId: ids.assistantA,
  text: "partial B",
})
assert.deepEqual(
  currentTimeline([user, supersededA, assistantB]).map((entry) => entry.id),
  [ids.user, ids.assistantB]
)
assert.equal(
  canRetryLatestAssistant([user, supersededA, assistantB], ids.assistantB),
  true
)

const supersededB = softSupersedeMessage(
  assistantB,
  "2026-08-26T00:01:00.000Z"
)
const assistantC = message({
  id: ids.assistantC,
  sequence: 4,
  role: "assistant",
  status: "generating",
  replacesMessageId: ids.assistantB,
})
assert.deepEqual(
  currentTimeline([user, supersededA, supersededB, assistantC]).map(
    (entry) => entry.id
  ),
  [ids.user, ids.assistantC],
  "A→B→C 每次 Retry 都创建新消息"
)
assert.equal(
  findMessageIncludingSuperseded(
    [user, supersededA, supersededB, assistantC],
    ids.assistantA
  )?.parts[0]?.text,
  "partial A",
  "superseded 消息仍可按 ID 读取"
)

assert.equal(canEditLatestUserTurn([user, assistantC], ids.user), true)
const newerUser = message({
  id: "10000000-0000-4000-8000-000000000007",
  sequence: 5,
  role: "user",
  status: "completed",
  text: "new question",
})
assert.equal(canEditLatestUserTurn([user, assistantC, newerUser], ids.user), false)

const frozen = buildFrozenForkContext({
  parentForkContext: ["inherited-user", "inherited-assistant"],
  parentMessages: [user, assistantA],
  sourceMessageId: ids.assistantA,
})
softSupersedeMessage(assistantA, "2026-08-26T00:02:00.000Z")
assert.deepEqual(frozen, [
  "inherited-user",
  "inherited-assistant",
  ids.user,
  ids.assistantA,
])

const sendPayload = {
  commandId: ids.command,
  userMessageId: ids.user,
  assistantMessageId: ids.assistantA,
  modelId: "test/model",
  text: "hello",
  files: [],
}
assert.equal(sendMessageCommandSchema.safeParse(sendPayload).success, true)
assert.equal(
  sendMessageCommandSchema.safeParse({ ...sendPayload, unknown: true }).success,
  false,
  "strict command schema 必须拒绝未知字段"
)
assert.equal(
  deleteProjectCommandSchema.safeParse({ commandId: ids.command }).success,
  true
)

const reorderedPayload = {
  text: "hello",
  files: [],
  modelId: "test/model",
  assistantMessageId: ids.assistantA,
  userMessageId: ids.user,
  commandId: ids.command,
}
assert.equal(hasSameCommandSemantics(sendPayload, reorderedPayload), true)
assert.equal(
  hasSameCommandSemantics(sendPayload, { ...reorderedPayload, text: "changed" }),
  false,
  "同 command ID 的异义负载必须可检测"
)
assert.equal(canonicalCommandPayload(sendPayload), canonicalCommandPayload(reorderedPayload))

assert.equal(isRootThread({ parentId: null }), true)
assert.equal(isRootThread({ parentId: ids.thread }), false)

console.log("PASS normalized conversation contracts")
