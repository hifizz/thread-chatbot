import assert from "node:assert/strict"
import test from "node:test"

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

const WORKSPACE_ID = workspaceId("workspace-fixture")
const PROJECT_ID = projectId("project-fixture")
const CONVERSATION_ID = conversationId("conversation-fixture")

function canonicalFixture(): ConversationSnapshot {
  const root = threadId("canonical:thread:root")
  const branchA = threadId("canonical:thread:A")
  const branchB = threadId("canonical:thread:B")
  const rootTurn = turnId("canonical:turn:root")
  const aTurn = turnId("canonical:turn:A")
  const bTurn = turnId("canonical:turn:B")
  const rootUser = messageId("canonical:message:root:user")
  const rootAssistant = messageId("canonical:message:root:assistant")
  const aUser = messageId("canonical:message:A:user")
  const aAssistant = messageId("canonical:message:A:assistant")
  const bUser = messageId("canonical:message:B:user")
  const bAssistant1 = messageId("canonical:message:B:assistant:1")
  const bAssistant2 = messageId("canonical:message:B:assistant:2")
  const content = (text: string) => ({
    schemaVersion: 1 as const,
    parts: [{ type: "text" as const, text }],
  })
  const createdAt = "1970-01-01T00:00:00.000Z"
  return {
    schemaVersion: 1,
    project: {
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      title: "测试 Project",
      revision: 0,
      lifecycle: "active",
    },
    conversation: {
      id: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rootThreadId: root,
      autoTitle: "自动标题",
      customTitle: null,
      revision: 0,
      lifecycle: "active",
    },
    threads: Object.fromEntries(
      [
        [root, null],
        [branchA, "分支 A"],
        [branchB, "分支 B"],
      ].map(([id, localTitle]) => [
        id,
        {
          id,
          conversationId: CONVERSATION_ID,
          modelId: "glm-5.3",
          localTitle,
          revision: 0,
          lifecycle: "active" as const,
        },
      ])
    ),
    threadForks: {
      "canonical:fork:A": {
        id: threadForkId("canonical:fork:A"),
        conversationId: CONVERSATION_ID,
        parentThreadId: root,
        sourceMessageId: rootAssistant,
        childThreadId: branchA,
        createdBy: "fixture-user",
        createdAt,
      },
      "canonical:fork:B": {
        id: threadForkId("canonical:fork:B"),
        conversationId: CONVERSATION_ID,
        parentThreadId: branchA,
        sourceMessageId: aAssistant,
        childThreadId: branchB,
        createdBy: "fixture-user",
        createdAt,
      },
    },
    turns: {
      [rootTurn]: {
        id: rootTurn,
        threadId: root,
        position: 0,
        activeUserMessageId: rootUser,
        activeAssistantMessageId: rootAssistant,
        revision: 0,
      },
      [aTurn]: {
        id: aTurn,
        threadId: branchA,
        position: 0,
        activeUserMessageId: aUser,
        activeAssistantMessageId: aAssistant,
        revision: 0,
      },
      [bTurn]: {
        id: bTurn,
        threadId: branchB,
        position: 0,
        activeUserMessageId: bUser,
        activeAssistantMessageId: bAssistant2,
        revision: 1,
      },
    },
    messages: Object.fromEntries(
      [
        [rootUser, root, rootTurn, "user", "根问题", undefined],
        [rootAssistant, root, rootTurn, "assistant", "根回答", undefined],
        [aUser, branchA, aTurn, "user", "A 问题", undefined],
        [aAssistant, branchA, aTurn, "assistant", "A 回答", undefined],
        [bUser, branchB, bTurn, "user", "B 问题", undefined],
        [bAssistant1, branchB, bTurn, "assistant", "B 初始回答", undefined],
        [
          bAssistant2,
          branchB,
          bTurn,
          "assistant",
          "B 重新生成回答",
          bAssistant1,
        ],
      ].map(([id, targetThread, targetTurn, role, text, variant]) => [
        id,
        {
          id,
          threadId: targetThread,
          turnId: targetTurn,
          role,
          content: content(text as string),
          contentState: "complete" as const,
          ...(variant ? { variantOfMessageId: variant } : {}),
          createdAt,
        },
      ])
    ) as ConversationSnapshot["messages"],
    generations: {},
    artifactProvenance: {},
  }
}

test("A → B → C 规范实体产生合法的 Project → Conversation → Thread 快照", () => {
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
