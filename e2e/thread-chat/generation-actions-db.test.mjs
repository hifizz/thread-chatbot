import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "../../lib/db/index.ts"
import { branchGenerations, branchTrees, user } from "../../lib/db/schema.ts"
import {
  GenerationRepositoryError,
  prepareGeneration,
} from "../../lib/thread-chat-generation/repository.ts"

const suffix = randomUUID()
const userId = `generation-actions-${suffix}`
const treeId = randomUUID()
const generationIds = Array.from({ length: 3 }, () => randomUUID())

const initialState = {
  schemaVersion: 2,
  threads: {
    main: {
      id: "main",
      modelId: "glm-5.2",
      parentId: null,
      depth: 0,
      title: "主线",
      anchorText: null,
      forkFromMsgId: null,
      footnote: null,
      children: [],
      messages: [
        {
          id: "u1",
          parentMessageId: null,
          role: "user",
          text: "原问题",
          quote: { text: "原引用" },
          forks: [],
        },
        {
          id: "a1",
          parentMessageId: "u1",
          role: "assistant",
          text: "原答案",
          forks: [{ text: "锚点", num: 1, threadId: "b1", depth: 1 }],
          artifactIds: ["artifact-a"],
          generationId: randomUUID(),
          status: "done",
        },
      ],
      activeLeafMessageId: "a1",
      lastActive: 1,
    },
  },
  artifacts: {
    "artifact-a": {
      id: "artifact-a",
      title: "旧产物",
      kind: "markdown",
      content: "old",
      sourceThreadId: "main",
      sourceMessageId: "a1",
    },
  },
  artifactOrder: ["artifact-a"],
  recents: [],
  footnoteCounter: 1,
  seq: 10,
  tick: 1,
}

const baseInput = {
  userId,
  treeId,
  threadId: "main",
  modelId: "glm-5.2",
}

async function run() {
  await db.insert(user).values({
    id: userId,
    name: "generation action test",
    email: `${userId}@example.test`,
    emailVerified: true,
  })
  await db.insert(branchTrees).values({
    id: treeId,
    userId,
    state: initialState,
  })

  const regenerated = await prepareGeneration({
    ...baseInput,
    userMessageId: "u1",
    assistantMessageId: "a2",
    generationId: generationIds[0],
    intent: {
      kind: "regenerate-assistant",
      sourceAssistantMessageId: "a1",
    },
  })
  assert.equal(regenerated.created, true)
  assert.equal(regenerated.revision, 1)
  assert.equal(regenerated.state.threads.main.activeLeafMessageId, "a2")
  assert.equal(
    regenerated.state.threads.main.messages.find(
      (message) => message.id === "a1"
    ).text,
    "原答案"
  )
  assert.equal(regenerated.state.artifacts["artifact-a"].sourceMessageId, "a1")

  const replay = await prepareGeneration({
    ...baseInput,
    userMessageId: "u1",
    assistantMessageId: "a2",
    generationId: generationIds[0],
    intent: {
      kind: "regenerate-assistant",
      sourceAssistantMessageId: "a1",
    },
  })
  assert.equal(replay.created, false)
  const [afterReplay] = await db
    .select({ state: branchTrees.state })
    .from(branchTrees)
    .where(eq(branchTrees.id, treeId))
  assert.equal(
    afterReplay.state.threads.main.messages.filter(
      (message) => message.id === "a2"
    ).length,
    1,
    "generation replay must not duplicate sibling nodes"
  )

  const edited = await prepareGeneration({
    ...baseInput,
    userMessageId: "u2",
    assistantMessageId: "a3",
    generationId: generationIds[1],
    intent: {
      kind: "edit-last-user",
      sourceUserMessageId: "u1",
      text: "编辑后的问题",
    },
  })
  assert.equal(edited.created, true)
  assert.equal(edited.revision, 2)
  assert.equal(edited.state.threads.main.activeLeafMessageId, "a3")
  const u2 = edited.state.threads.main.messages.find(
    (message) => message.id === "u2"
  )
  assert.equal(u2.parentMessageId, null)
  assert.deepEqual(u2.quote, { text: "原引用" })
  assert.deepEqual(u2.forks, [])
  assert.equal(
    (
      await db
        .select()
        .from(branchGenerations)
        .where(eq(branchGenerations.id, generationIds[0]))
    )[0].status,
    "superseded"
  )

  await assert.rejects(
    prepareGeneration({
      ...baseInput,
      userMessageId: "u1",
      assistantMessageId: "a-historical",
      generationId: randomUUID(),
      intent: {
        kind: "regenerate-assistant",
        sourceAssistantMessageId: "a1",
      },
    }),
    (error) =>
      error instanceof GenerationRepositoryError &&
      error.code === "not_latest_turn"
  )

  const orphanState = structuredClone(edited.state)
  orphanState.threads.main.messages.push({
    id: "u-orphan",
    parentMessageId: "a3",
    role: "user",
    text: "孤儿问题",
    forks: [],
  })
  orphanState.threads.main.activeLeafMessageId = "u-orphan"
  await db
    .update(branchTrees)
    .set({ state: orphanState, revision: 3 })
    .where(eq(branchTrees.id, treeId))
  const retried = await prepareGeneration({
    ...baseInput,
    userMessageId: "u-orphan",
    assistantMessageId: "a-orphan",
    generationId: generationIds[2],
    intent: { kind: "retry-orphan-user" },
  })
  assert.equal(retried.created, true)
  assert.equal(retried.state.threads.main.activeLeafMessageId, "a-orphan")
  assert.equal(
    retried.state.threads.main.messages.find(
      (message) => message.id === "a-orphan"
    ).parentMessageId,
    "u-orphan"
  )

  console.log(
    "PASS  atomic regenerate/edit/orphan intents, replay, supersession and immutable provenance"
  )
}

try {
  await run()
} finally {
  await db.delete(user).where(eq(user.id, userId))
}
