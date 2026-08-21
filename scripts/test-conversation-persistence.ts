import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { config } from "dotenv"

config({ path: ".env.local" })

const { count, eq } = await import("drizzle-orm")
const { db } = await import("../lib/db/index.ts")
const {
  conversationMessages,
  conversationTurns,
  conversations,
  projects,
  threadForks,
  user,
  workspaces,
} = await import("../lib/db/schema.ts")
const { ConversationRepositoryError } =
  await import("../lib/thread-chat/application/conversation-repository.ts")
const { deriveConversationReadIndexes } =
  await import("../lib/thread-chat/application/conversation-read-indexes.ts")
const {
  conversationId,
  messageId,
  projectId,
  threadForkId,
  threadId,
  turnId,
  workspaceId,
} = await import("../lib/thread-chat/domain/conversation-model.ts")
const { DrizzleConversationRepository } =
  await import("../lib/thread-chat/persistence/drizzle-conversation-repository.ts")
const { assertCanonicalWriteAllowed } =
  await import("../lib/thread-chat/persistence/canonical-persistence-policy.ts")

const runId = randomUUID()
const prefix = `persistence-test:${runId}`
const userId = `${prefix}:user`
const workspace = workspaceId(`${prefix}:workspace`)
const project = projectId(`${prefix}:project`)
const conversation = conversationId(`${prefix}:conversation`)
const root = threadId(`${prefix}:thread:root`)
const repository = new DrizzleConversationRepository({
  writeMode: "isolated-test",
  legacyWritesEnabled: true,
})

function content(text: string) {
  return {
    schemaVersion: 1 as const,
    parts: [{ type: "text" as const, text }],
  }
}

function turnFixture(input: {
  thread: ReturnType<typeof threadId>
  suffix: string
  position: number
}) {
  const turn = turnId(`${prefix}:turn:${input.suffix}`)
  const userMessage = messageId(`${prefix}:message:${input.suffix}:user`)
  const assistantMessage = messageId(
    `${prefix}:message:${input.suffix}:assistant`
  )
  return {
    turn: {
      id: turn,
      threadId: input.thread,
      position: input.position,
      activeUserMessageId: userMessage,
      activeAssistantMessageId: assistantMessage,
      revision: 0,
    },
    userMessage: {
      id: userMessage,
      threadId: input.thread,
      turnId: turn,
      role: "user" as const,
      content: content(`${input.suffix} 用户消息`),
      contentState: "complete" as const,
      createdAt: "2026-08-22T00:00:00.000Z",
    },
    assistantMessage: {
      id: assistantMessage,
      threadId: input.thread,
      turnId: turn,
      role: "assistant" as const,
      content: content(`${input.suffix} 助手消息`),
      contentState: "complete" as const,
      createdAt: "2026-08-22T00:00:01.000Z",
    },
  }
}

async function expectRepositoryCode(
  code: string,
  action: () => Promise<unknown>
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ConversationRepositoryError)
    assert.equal(error.code, code)
    return true
  })
}

async function expectDatabaseRejection(
  label: string,
  expectedConstraint: string,
  action: () => Promise<unknown>
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof Error, `${label} 应返回数据库错误`)
    let current: unknown = error
    let constraint: string | undefined
    while (current && typeof current === "object") {
      const candidate = current as {
        readonly cause?: unknown
        readonly constraint_name?: unknown
        readonly constraint?: unknown
      }
      const value = candidate.constraint_name ?? candidate.constraint
      if (typeof value === "string") {
        constraint = value
        break
      }
      current = candidate.cause
    }
    assert.equal(
      constraint,
      expectedConstraint,
      `${label} 应由 ${expectedConstraint} 拒绝`
    )
    return true
  })
}

async function createConversationFixture(input: {
  id: ReturnType<typeof conversationId>
  root: ReturnType<typeof threadId>
  title: string
}): Promise<void> {
  await repository.createConversation({
    actorUserId: userId,
    projectId: project,
    conversation: {
      id: input.id,
      rootThreadId: input.root,
      autoTitle: input.title,
      customTitle: null,
      revision: 0,
      lifecycle: "active",
    },
    rootThread: {
      id: input.root,
      conversationId: input.id,
      modelId: "ark-glm-5.3",
      localTitle: null,
      revision: 0,
      lifecycle: "active",
    },
  })
}

let assertions = 0
try {
  assert.throws(
    () =>
      assertCanonicalWriteAllowed({
        writeMode: "disabled",
        legacyWritesEnabled: true,
      }),
    (error: unknown) =>
      error instanceof ConversationRepositoryError &&
      error.code === "canonical_writes_disabled"
  )
  assert.throws(
    () =>
      assertCanonicalWriteAllowed({
        writeMode: "canonical",
        legacyWritesEnabled: true,
      }),
    (error: unknown) =>
      error instanceof ConversationRepositoryError &&
      error.code === "dual_write_forbidden"
  )
  assertions += 2

  await db.insert(user).values({
    id: userId,
    name: "Conversation Persistence Test",
    email: `${runId}@conversation-persistence.invalid`,
    emailVerified: true,
  })
  await repository.createWorkspace({
    workspace: { id: workspace, revision: 0, lifecycle: "active" },
    ownerUserId: userId,
  })
  await repository.createProject({
    actorUserId: userId,
    project: {
      id: project,
      workspaceId: workspace,
      title: "规范持久化测试",
      revision: 0,
      lifecycle: "active",
    },
  })
  await createConversationFixture({ id: conversation, root, title: "根会话" })

  const rootTurn = turnFixture({ thread: root, suffix: "root", position: 0 })
  assert.equal(
    await repository.appendTurn({
      actorUserId: userId,
      conversationId: conversation,
      expectedThreadRevision: 0,
      ...rootTurn,
    }),
    1
  )
  assertions += 1

  const threadA = threadId(`${prefix}:thread:A`)
  const threadB = threadId(`${prefix}:thread:B`)
  const threadC = threadId(`${prefix}:thread:C`)

  assert.equal(
    await repository.forkThread({
      actorUserId: userId,
      conversationId: conversation,
      expectedConversationRevision: 0,
      childThread: {
        id: threadA,
        conversationId: conversation,
        modelId: "ark-glm-5.3",
        localTitle: "A",
        revision: 0,
        lifecycle: "active",
      },
      fork: {
        id: threadForkId(`${prefix}:fork:A`),
        conversationId: conversation,
        parentThreadId: root,
        sourceMessageId: rootTurn.assistantMessage.id,
        childThreadId: threadA,
        createdBy: userId,
        createdAt: "2026-08-22T00:01:00.000Z",
      },
    }),
    1
  )
  const turnA = turnFixture({ thread: threadA, suffix: "A", position: 0 })
  await repository.appendTurn({
    actorUserId: userId,
    conversationId: conversation,
    expectedThreadRevision: 0,
    ...turnA,
  })
  assert.equal(
    await repository.forkThread({
      actorUserId: userId,
      conversationId: conversation,
      expectedConversationRevision: 1,
      childThread: {
        id: threadB,
        conversationId: conversation,
        modelId: "ark-glm-5.3",
        localTitle: "B",
        revision: 0,
        lifecycle: "active",
      },
      fork: {
        id: threadForkId(`${prefix}:fork:B`),
        conversationId: conversation,
        parentThreadId: threadA,
        sourceMessageId: turnA.assistantMessage.id,
        childThreadId: threadB,
        createdBy: userId,
        createdAt: "2026-08-22T00:02:00.000Z",
      },
    }),
    2
  )
  const turnB = turnFixture({ thread: threadB, suffix: "B", position: 0 })
  await repository.appendTurn({
    actorUserId: userId,
    conversationId: conversation,
    expectedThreadRevision: 0,
    ...turnB,
  })
  assert.equal(
    await repository.forkThread({
      actorUserId: userId,
      conversationId: conversation,
      expectedConversationRevision: 2,
      childThread: {
        id: threadC,
        conversationId: conversation,
        modelId: "ark-glm-5.3",
        localTitle: "C",
        revision: 0,
        lifecycle: "active",
      },
      fork: {
        id: threadForkId(`${prefix}:fork:C`),
        conversationId: conversation,
        parentThreadId: threadB,
        sourceMessageId: turnB.assistantMessage.id,
        childThreadId: threadC,
        createdBy: userId,
        createdAt: "2026-08-22T00:03:00.000Z",
      },
    }),
    3
  )
  const turnC = turnFixture({ thread: threadC, suffix: "C", position: 0 })
  await repository.appendTurn({
    actorUserId: userId,
    conversationId: conversation,
    expectedThreadRevision: 0,
    ...turnC,
  })
  assertions += 3

  const regenerated = messageId(`${prefix}:message:root:assistant:variant`)
  assert.equal(
    await repository.appendMessageVariant({
      actorUserId: userId,
      conversationId: conversation,
      expectedTurnRevision: 0,
      sourceMessageId: rootTurn.assistantMessage.id,
      select: true,
      message: {
        id: regenerated,
        threadId: root,
        turnId: rootTurn.turn.id,
        role: "assistant",
        content: content("重新生成回答"),
        contentState: "complete",
        createdAt: "2026-08-22T00:04:00.000Z",
      },
    }),
    1
  )
  assert.equal(
    await repository.selectMessageVariant({
      actorUserId: userId,
      conversationId: conversation,
      turnId: rootTurn.turn.id,
      messageId: rootTurn.assistantMessage.id,
      role: "assistant",
      expectedRevision: 1,
    }),
    2
  )
  assertions += 2

  const snapshotOne = await repository.getConversationSnapshot({
    actorUserId: userId,
    conversationId: conversation,
  })
  const snapshotTwo = await repository.getConversationSnapshot({
    actorUserId: userId,
    conversationId: conversation,
  })
  assert.ok(snapshotOne)
  assert.deepEqual(snapshotTwo, snapshotOne)
  assert.equal(Object.keys(snapshotOne.threads).length, 4)
  assert.equal(Object.keys(snapshotOne.threadForks).length, 3)
  assert.equal(Object.keys(snapshotOne.messages).length, 9)
  assert.equal(
    snapshotOne.turns[rootTurn.turn.id]?.activeAssistantMessageId,
    rootTurn.assistantMessage.id
  )
  assert.deepEqual(
    deriveConversationReadIndexes(snapshotOne),
    deriveConversationReadIndexes(snapshotTwo!)
  )
  assert.deepEqual(
    deriveConversationReadIndexes(snapshotOne).childThreadIdsByParentThread[
      root
    ],
    [threadA]
  )
  assert.equal("saveConversationSnapshot" in repository, false)
  assertions += 9

  const secondConversation = conversationId(`${prefix}:conversation:second`)
  const secondRoot = threadId(`${prefix}:thread:second-root`)
  await createConversationFixture({
    id: secondConversation,
    root: secondRoot,
    title: "第二会话",
  })
  const secondTurn = turnFixture({
    thread: secondRoot,
    suffix: "second-root",
    position: 0,
  })
  await repository.appendTurn({
    actorUserId: userId,
    conversationId: secondConversation,
    expectedThreadRevision: 0,
    ...secondTurn,
  })
  await expectRepositoryCode("invalid_variant", () =>
    repository.appendMessageVariant({
      actorUserId: userId,
      conversationId: conversation,
      expectedTurnRevision: 0,
      sourceMessageId: secondTurn.assistantMessage.id,
      select: true,
      message: {
        id: messageId(`${prefix}:message:cross-conversation-variant`),
        threadId: secondRoot,
        turnId: secondTurn.turn.id,
        role: "assistant",
        content: content("不能借用另一条 Conversation 的授权参数"),
        contentState: "complete",
        createdAt: "2026-08-22T00:04:30.000Z",
      },
    })
  )
  await expectRepositoryCode("invalid_fork", () =>
    repository.forkThread({
      actorUserId: userId,
      conversationId: conversation,
      expectedConversationRevision: 3,
      childThread: {
        id: threadId(`${prefix}:thread:cross-conversation`),
        conversationId: secondConversation,
        modelId: "ark-glm-5.3",
        localTitle: "非法",
        revision: 0,
        lifecycle: "active",
      },
      fork: {
        id: threadForkId(`${prefix}:fork:cross-conversation`),
        conversationId: conversation,
        parentThreadId: root,
        sourceMessageId: rootTurn.assistantMessage.id,
        childThreadId: threadId(`${prefix}:thread:cross-conversation`),
        createdBy: userId,
        createdAt: "2026-08-22T00:05:00.000Z",
      },
    })
  )
  await expectRepositoryCode("invalid_fork", () =>
    repository.forkThread({
      actorUserId: userId,
      conversationId: conversation,
      expectedConversationRevision: 3,
      childThread: {
        id: threadId(`${prefix}:thread:wrong-source`),
        conversationId: conversation,
        modelId: "ark-glm-5.3",
        localTitle: "非法来源",
        revision: 0,
        lifecycle: "active",
      },
      fork: {
        id: threadForkId(`${prefix}:fork:wrong-source`),
        conversationId: conversation,
        parentThreadId: threadA,
        sourceMessageId: rootTurn.assistantMessage.id,
        childThreadId: threadId(`${prefix}:thread:wrong-source`),
        createdBy: userId,
        createdAt: "2026-08-22T00:06:00.000Z",
      },
    })
  )
  assertions += 3

  await expectDatabaseRejection(
    "第二入向 Fork",
    "thread_forks_child_thread_uq",
    () =>
      db.transaction(async (transaction) => {
        await transaction.insert(threadForks).values({
          id: `${prefix}:fork:duplicate-incoming`,
          conversationId: conversation,
          parentThreadId: root,
          sourceMessageId: rootTurn.assistantMessage.id,
          childThreadId: threadA,
          createdBy: userId,
        })
      })
  )
  await expectDatabaseRejection("Fork 环", "conversation_fork_acyclic_ck", () =>
    db.transaction(async (transaction) => {
      await transaction
        .update(threadForks)
        .set({
          parentThreadId: threadC,
          sourceMessageId: turnC.assistantMessage.id,
        })
        .where(eq(threadForks.id, `${prefix}:fork:A`))
    })
  )
  await expectDatabaseRejection(
    "跨 Thread Message/Turn",
    "conversation_messages_turn_thread_fk",
    () =>
      db.transaction(async (transaction) => {
        await transaction.insert(conversationMessages).values({
          id: `${prefix}:message:cross-thread`,
          threadId: threadA,
          turnId: rootTurn.turn.id,
          role: "assistant",
          content: content("非法跨 Thread"),
          contentState: "complete",
        })
      })
  )
  const wrongRoleMessage = messageId(`${prefix}:message:wrong-active-role`)
  await expectDatabaseRejection(
    "错误角色 active Message",
    "conversation_turn_active_assistant_role_ck",
    () =>
      db.transaction(async (transaction) => {
        await transaction.insert(conversationMessages).values({
          id: wrongRoleMessage,
          threadId: root,
          turnId: rootTurn.turn.id,
          role: "user",
          content: content("不能成为 active assistant"),
          contentState: "complete",
          variantOfMessageId: rootTurn.userMessage.id,
        })
        await transaction
          .update(conversationTurns)
          .set({ activeAssistantMessageId: wrongRoleMessage })
          .where(eq(conversationTurns.id, rootTurn.turn.id))
      })
  )
  await expectDatabaseRejection(
    "根 Thread 身份变化",
    "conversations_root_thread_immutable_ck",
    () =>
      db.transaction(async (transaction) => {
        await transaction
          .update(conversations)
          .set({ rootThreadId: threadA })
          .where(eq(conversations.id, conversation))
      })
  )
  assertions += 5

  const [canonicalCount] = await db
    .select({ value: count(conversations.id) })
    .from(conversations)
    .innerJoin(projects, eq(projects.id, conversations.projectId))
    .where(eq(projects.workspaceId, workspace))
  assert.equal(canonicalCount?.value, 2)
  assertions += 1

  console.log(
    JSON.stringify({
      ok: true,
      assertions,
      topology: "root → A → B → C",
      snapshotStable: true,
      wholeSnapshotWritePort: false,
    })
  )
} finally {
  await db.delete(workspaces).where(eq(workspaces.id, workspace))
  await db.delete(user).where(eq(user.id, userId))
  await globalThis.__dbClient?.end()
  globalThis.__dbClient = undefined
}
