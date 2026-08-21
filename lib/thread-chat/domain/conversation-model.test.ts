import assert from "node:assert/strict"
import test from "node:test"

import { THREAD_TREE_SCHEMA_VERSION } from "../../../constants/thread-chat.ts"
import {
  conversationId,
  generationId,
  messageId,
  projectId,
  threadForkId,
  threadId,
  turnId,
  workspaceId,
  type ConversationSnapshot,
} from "./conversation-model.ts"
import { selectActiveVariant } from "./conversation-selection.ts"
import {
  resolveConversationTitle,
  resolveThreadTitle,
} from "./conversation-title.ts"
import {
  assertValidConversationSnapshot,
  validateConversationSnapshot,
} from "./conversation-validation.ts"
import type { ThreadTreeState } from "./types.ts"
import { projectLegacyThreadTree } from "../legacy/project-thread-tree.ts"

const WORKSPACE_ID = workspaceId("workspace-fixture")
const PROJECT_ID = projectId("project-fixture")
const CONVERSATION_ID = conversationId("conversation-fixture")

function legacyFixture(): ThreadTreeState {
  return {
    schemaVersion: THREAD_TREE_SCHEMA_VERSION,
    threads: {
      main: {
        id: "main",
        modelId: "ark-glm-5.3",
        parentId: null,
        depth: 0,
        title: "遗留根标题",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: ["A"],
        messages: [
          {
            id: "root-user",
            parentMessageId: null,
            role: "user",
            text: "根问题",
            forks: [],
          },
          {
            id: "root-assistant",
            parentMessageId: "root-user",
            role: "assistant",
            text: "根回答",
            forks: [
              {
                text: "根回答",
                num: 1,
                threadId: "A",
                depth: 1,
              },
            ],
          },
        ],
        activeLeafMessageId: "root-assistant",
        lastActive: 1,
      },
      A: {
        id: "A",
        modelId: "ark-glm-5.3",
        parentId: "main",
        depth: 1,
        title: "分支 A",
        anchorText: "根回答",
        forkFromMsgId: "root-assistant",
        footnote: 1,
        children: ["B"],
        messages: [
          {
            id: "a-user",
            parentMessageId: null,
            role: "user",
            text: "A 问题",
            forks: [],
          },
          {
            id: "a-assistant",
            parentMessageId: "a-user",
            role: "assistant",
            text: "A 回答",
            forks: [
              {
                text: "A 回答",
                num: 2,
                threadId: "B",
                depth: 2,
              },
            ],
          },
        ],
        activeLeafMessageId: "a-assistant",
        lastActive: 2,
      },
      B: {
        id: "B",
        modelId: "ark-glm-5.3",
        parentId: "A",
        depth: 2,
        title: "分支 B",
        anchorText: "A 回答",
        forkFromMsgId: "a-assistant",
        footnote: 2,
        children: [],
        messages: [
          {
            id: "b-user",
            parentMessageId: null,
            role: "user",
            text: "B 问题",
            forks: [],
          },
          {
            id: "b-assistant-1",
            parentMessageId: "b-user",
            role: "assistant",
            text: "B 初始回答",
            forks: [],
          },
          {
            id: "b-assistant-2",
            parentMessageId: "b-user",
            role: "assistant",
            text: "B 重新生成回答",
            forks: [],
          },
        ],
        activeLeafMessageId: "b-assistant-2",
        lastActive: 3,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: ["B", "A"],
    footnoteCounter: 2,
    seq: 20,
    tick: 3,
  }
}

function canonicalFixture(): ConversationSnapshot {
  return projectLegacyThreadTree({
    legacyTreeId: "legacy-fixture",
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    projectTitle: "测试 Project",
    conversationAutoTitle: "自动标题",
    conversationCustomTitle: null,
    actorId: "fixture-user",
    state: legacyFixture(),
  })
}

test("单向投影产生合法的 Project → Conversation → Thread 快照", () => {
  const snapshot = canonicalFixture()
  assert.doesNotThrow(() => assertValidConversationSnapshot(snapshot))
  assert.equal(Object.keys(snapshot.threads).length, 3)
  assert.equal(Object.keys(snapshot.threadForks).length, 2)
  assert.notEqual(snapshot.conversation.rootThreadId, "main")
})

test("B 的重新生成变体不会投影到 A", () => {
  const snapshot = canonicalFixture()
  const threadA = Object.values(snapshot.threads).find((thread) =>
    thread.id.endsWith(":thread:A")
  )
  const threadB = Object.values(snapshot.threads).find((thread) =>
    thread.id.endsWith(":thread:B")
  )
  assert.ok(threadA)
  assert.ok(threadB)

  const assistantsInA = Object.values(snapshot.messages).filter(
    (message) => message.threadId === threadA.id && message.role === "assistant"
  )
  const assistantsInB = Object.values(snapshot.messages).filter(
    (message) => message.threadId === threadB.id && message.role === "assistant"
  )
  assert.equal(assistantsInA.length, 1)
  assert.equal(assistantsInB.length, 2)
  assert.equal(assistantsInB[1]?.variantOfMessageId, assistantsInB[0]?.id)
})

test("重复入向 Fork 与 Fork 环会被拒绝", () => {
  const snapshot = canonicalFixture()
  const rootThreadId = snapshot.conversation.rootThreadId
  const branchB = Object.values(snapshot.threads).find((thread) =>
    thread.id.endsWith(":thread:B")
  )
  const rootAssistant = Object.values(snapshot.messages).find(
    (message) =>
      message.threadId === rootThreadId && message.role === "assistant"
  )
  assert.ok(branchB)
  assert.ok(rootAssistant)
  const duplicateId = threadForkId("fixture-duplicate-fork")
  const cyclicId = threadForkId("fixture-cyclic-fork")
  const invalid: ConversationSnapshot = {
    ...snapshot,
    threadForks: {
      ...snapshot.threadForks,
      [duplicateId]: {
        id: duplicateId,
        conversationId: snapshot.conversation.id,
        parentThreadId: rootThreadId,
        sourceMessageId: rootAssistant.id,
        childThreadId: branchB.id,
        createdBy: "fixture-user",
        createdAt: "1970-01-01T00:00:00.000Z",
      },
      [cyclicId]: {
        id: cyclicId,
        conversationId: snapshot.conversation.id,
        parentThreadId: branchB.id,
        sourceMessageId: Object.values(snapshot.messages).find(
          (message) =>
            message.threadId === branchB.id && message.role === "assistant"
        )!.id,
        childThreadId: rootThreadId,
        createdBy: "fixture-user",
        createdAt: "1970-01-01T00:00:00.000Z",
      },
    },
  }
  const codes = new Set(
    validateConversationSnapshot(invalid).map((entry) => entry.code)
  )
  assert.ok(codes.has("duplicate_incoming_fork"))
  assert.ok(codes.has("root_has_incoming_fork"))
  assert.ok(codes.has("fork_cycle"))
})

test("跨 Thread Generation 会被拒绝", () => {
  const snapshot = canonicalFixture()
  const rootThread = snapshot.threads[snapshot.conversation.rootThreadId]!
  const branchB = Object.values(snapshot.threads).find((thread) =>
    thread.id.endsWith(":thread:B")
  )!
  const branchTurn = Object.values(snapshot.turns).find(
    (turn) => turn.threadId === branchB.id
  )!
  const id = generationId("fixture-cross-thread-generation")
  const invalid: ConversationSnapshot = {
    ...snapshot,
    generations: {
      [id]: {
        id,
        threadId: rootThread.id,
        turnId: branchTurn.id,
        inputMessageId: branchTurn.activeUserMessageId,
        outputMessageId: branchTurn.activeAssistantMessageId,
        intent: { kind: "send" },
        status: "running",
        billingStatus: "pending",
        attempt: 1,
        createdAt: "1970-01-01T00:00:00.000Z",
      },
    },
  }
  assert.ok(
    validateConversationSnapshot(invalid).some(
      (entry) => entry.code === "generation_identity_mismatch"
    )
  )
})

test("变体选择使用 Turn revision 并限制在同一 Turn", () => {
  const snapshot = canonicalFixture()
  const branchB = Object.values(snapshot.threads).find((thread) =>
    thread.id.endsWith(":thread:B")
  )!
  const turn = Object.values(snapshot.turns).find(
    (candidate) => candidate.threadId === branchB.id
  )!
  const alternatives = Object.values(snapshot.messages).filter(
    (message) => message.turnId === turn.id && message.role === "assistant"
  )
  const result = selectActiveVariant(snapshot, {
    turnId: turn.id,
    messageId: alternatives[0]!.id,
    role: "assistant",
    expectedRevision: turn.revision,
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.turn.activeAssistantMessageId, alternatives[0]!.id)
    assert.equal(result.turn.revision, turn.revision + 1)
  }

  const conflict = selectActiveVariant(snapshot, {
    turnId: turn.id,
    messageId: alternatives[0]!.id,
    role: "assistant",
    expectedRevision: turn.revision + 1,
  })
  assert.deepEqual(conflict, {
    ok: false,
    code: "version_conflict",
    currentRevision: turn.revision,
  })
})

test("Conversation 独占根列标题，非根 Thread 使用本地标题", () => {
  const snapshot = canonicalFixture()
  const root = snapshot.threads[snapshot.conversation.rootThreadId]!
  const branch = Object.values(snapshot.threads).find(
    (thread) => thread.id !== root.id
  )!
  assert.equal(resolveConversationTitle(snapshot.conversation), "自动标题")
  assert.equal(
    resolveThreadTitle({ conversation: snapshot.conversation, thread: root }),
    "自动标题"
  )
  assert.equal(
    resolveThreadTitle({ conversation: snapshot.conversation, thread: branch }),
    branch.localTitle
  )
})

test("规范 Thread ID 构造器拒绝遗留 main 魔法身份", () => {
  assert.throws(() => threadId("main"), /遗留角色键/)
})

test("跨 Turn Message 不能伪装为同 Turn 变体", () => {
  const snapshot = canonicalFixture()
  const turns = Object.values(snapshot.turns)
  assert.ok(turns.length >= 2)
  const targetTurn = turns[0]!
  const foreignMessage = snapshot.messages[turns[1]!.activeAssistantMessageId]!
  const fakeId = messageId("fixture-cross-turn-message")
  const invalid: ConversationSnapshot = {
    ...snapshot,
    messages: {
      ...snapshot.messages,
      [fakeId]: {
        ...foreignMessage,
        id: fakeId,
        threadId: targetTurn.threadId,
        turnId: targetTurn.id,
        variantOfMessageId: foreignMessage.id,
      },
    },
  }
  assert.ok(
    validateConversationSnapshot(invalid).some(
      (entry) => entry.code === "message_variant_mismatch"
    )
  )
})

// 避免测试数据里的品牌构造器因未来重命名成为未覆盖代码。
void turnId
