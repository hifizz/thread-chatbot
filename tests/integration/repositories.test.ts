import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import postgres from "postgres"
import { assertSafeTestDatabaseUrl } from "../../scripts/lib/test-database-safety.mjs"
import {
  createThreadChatRepositories,
  ThreadChatUnitOfWork,
} from "@/lib/thread-chat/infrastructure/repositories"

const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const sql = postgres(testDatabaseUrl, { max: 10 })
const unitOfWork = new ThreadChatUnitOfWork(sql)
const now = new Date("2026-01-01T00:00:00.000Z")

async function createUser(): Promise<string> {
  const userId = randomUUID()
  await sql`
    insert into thread_chat."user" (
      id, name, email, email_verified, created_at, updated_at
    ) values (
      ${userId},
      'Repository Test',
      ${`${userId}@thread-chat.test`},
      true,
      now(),
      now()
    )
  `
  return userId
}

async function createProjectWithRoot(actorId: string) {
  return unitOfWork.transaction(async (repositories) => {
    const project = await repositories.projects.insert({
      id: randomUUID(),
      ownerUserId: actorId,
    })
    const root = await repositories.threads.insertRoot({
      actorId,
      id: randomUUID(),
      projectId: project.id,
    })
    return { project, root }
  })
}

async function deleteUser(userId: string): Promise<void> {
  await sql`delete from thread_chat."user" where id = ${userId}`
}

afterAll(async () => {
  await sql.end()
})

describe("ThreadChat Repositories", () => {
  it("所有 owner-scoped Query 隔离其他 actor", async () => {
    const ownerId = await createUser()
    const otherId = await createUser()
    try {
      const { project, root } = await createProjectWithRoot(ownerId)
      const repositories = createThreadChatRepositories(sql)

      expect(
        await repositories.projects.findOwnedById(ownerId, project.id)
      ).toMatchObject({ id: project.id, ownerUserId: ownerId })
      expect(
        await repositories.projects.findOwnedById(otherId, project.id)
      ).toBeNull()
      expect(
        await repositories.threads.findOwnedById(otherId, root.id)
      ).toBeNull()
      expect(
        await repositories.threads.listOwnedTopology(otherId, project.id)
      ).toEqual([])
    } finally {
      await deleteUser(ownerId)
      await deleteUser(otherId)
    }
  })

  it("并发 append 通过 Thread 行锁分配唯一递增 sequence", async () => {
    const ownerId = await createUser()
    try {
      const { root } = await createProjectWithRoot(ownerId)
      const appended = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          unitOfWork.transaction((repositories) =>
            repositories.messages.append({
              actorId: ownerId,
              id: randomUUID(),
              threadId: root.id,
              role: "user",
              parts: [{ type: "text", text: `消息 ${index}` }],
              finalizedAt: now,
            })
          )
        )
      )

      expect(appended.map((message) => message.sequence).toSorted()).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ])
    } finally {
      await deleteUser(ownerId)
    }
  })

  it("finalized Message 只允许 replacement，assistant 只能封存一次", async () => {
    const ownerId = await createUser()
    try {
      const { root } = await createProjectWithRoot(ownerId)
      const result = await unitOfWork.transaction(async (repositories) => {
        const source = await repositories.messages.append({
          actorId: ownerId,
          id: randomUUID(),
          threadId: root.id,
          role: "user",
          parts: [{ type: "text", text: "旧内容" }],
          finalizedAt: now,
        })
        const replacement = await repositories.messages.append({
          actorId: ownerId,
          id: randomUUID(),
          threadId: root.id,
          role: "user",
          parts: [{ type: "text", text: "新内容" }],
          finalizedAt: now,
          replacesMessageId: source.id,
        })
        const assistant = await repositories.messages.append({
          actorId: ownerId,
          id: randomUUID(),
          threadId: root.id,
          role: "assistant",
          parts: null,
          finalizedAt: null,
        })
        const finalized = await repositories.messages.finalizeAssistantOnce({
          actorId: ownerId,
          messageId: assistant.id,
          parts: [{ type: "text", text: "最终内容" }],
          finalizedAt: now,
        })
        const duplicateFinalize =
          await repositories.messages.finalizeAssistantOnce({
            actorId: ownerId,
            messageId: assistant.id,
            parts: [{ type: "text", text: "覆盖内容" }],
            finalizedAt: now,
          })
        return { source, replacement, finalized, duplicateFinalize }
      })

      const sourceAfter = await createThreadChatRepositories(
        sql
      ).messages.findOwnedById(ownerId, result.source.id)
      expect(sourceAfter).toMatchObject({
        parts: [{ type: "text", text: "旧内容" }],
        sequence: result.source.sequence,
      })
      expect(sourceAfter?.supersededAt).toBeInstanceOf(Date)
      expect(result.replacement.replacesMessageId).toBe(result.source.id)
      expect(result.finalized?.parts).toEqual([
        { type: "text", text: "最终内容" },
      ])
      expect(result.duplicateFinalize).toBeNull()
    } finally {
      await deleteUser(ownerId)
    }
  })

  it("事务内拒绝跨 Project Fork 与 Artifact provenance", async () => {
    const ownerId = await createUser()
    try {
      const first = await createProjectWithRoot(ownerId)
      const second = await createProjectWithRoot(ownerId)
      const source = await unitOfWork.transaction((repositories) =>
        repositories.messages.append({
          actorId: ownerId,
          id: randomUUID(),
          threadId: first.root.id,
          role: "user",
          parts: [{ type: "text", text: "来源" }],
          finalizedAt: now,
        })
      )

      await expect(
        unitOfWork.transaction((repositories) =>
          repositories.threads.insertBranch({
            actorId: ownerId,
            id: randomUUID(),
            projectId: second.project.id,
            parentThreadId: second.root.id,
            sourceMessageId: source.id,
            forkSourceSnapshot: {
              schemaVersion: 1,
              sourceRole: "user",
              sourceSequence: source.sequence,
            },
            baseContext: { schemaVersion: 1, messageIds: [source.id] },
          })
        )
      ).rejects.toMatchObject({ code: "thread_source_invalid" })

      await expect(
        unitOfWork.transaction((repositories) =>
          repositories.artifacts.insert({
            actorId: ownerId,
            id: randomUUID(),
            projectId: second.project.id,
            sourceMessageId: source.id,
            kind: "markdown",
            title: "非法跨 Project Artifact",
            content: "# invalid",
          })
        )
      ).rejects.toMatchObject({ code: "artifact_provenance_invalid" })

      const childCount = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from thread_chat.threads
        where project_id = ${second.project.id}
      `
      expect(childCount[0].count).toBe(1)
    } finally {
      await deleteUser(ownerId)
    }
  })

  it("assistant Message 只有一个 Run，并持久化状态机、checkpoint 与 Stop", async () => {
    const ownerId = await createUser()
    try {
      const { root } = await createProjectWithRoot(ownerId)
      const result = await unitOfWork.transaction(async (repositories) => {
        const assistant = await repositories.messages.append({
          actorId: ownerId,
          id: randomUUID(),
          threadId: root.id,
          role: "assistant",
          parts: null,
          finalizedAt: null,
        })
        const queued = await repositories.messageRuns.insertQueued({
          actorId: ownerId,
          id: randomUUID(),
          assistantMessageId: assistant.id,
          modelId: "fake/test-model",
        })
        return { assistant, queued }
      })

      await expect(
        unitOfWork.transaction((repositories) =>
          repositories.messageRuns.insertQueued({
            actorId: ownerId,
            id: randomUUID(),
            assistantMessageId: result.assistant.id,
            modelId: "fake/test-model",
          })
        )
      ).rejects.toMatchObject({ code: "23505" })

      const running = await unitOfWork.transaction((repositories) =>
        repositories.messageRuns.transition({
          actorId: ownerId,
          messageRunId: result.queued.id,
          expectedStatus: "queued",
          nextStatus: "running",
        })
      )
      const checkpoint = await unitOfWork.transaction((repositories) =>
        repositories.messageRuns.checkpoint({
          actorId: ownerId,
          messageRunId: result.queued.id,
          expectedEventSequence: 0,
          checkpointParts: [{ type: "text", text: "部分内容" }],
          heartbeatAt: now,
        })
      )
      const stopped = await unitOfWork.transaction((repositories) =>
        repositories.messageRuns.requestStop(ownerId, result.assistant.id, now)
      )

      expect(running?.status).toBe("running")
      expect(checkpoint).toMatchObject({
        eventSequence: 1,
        checkpointParts: [{ type: "text", text: "部分内容" }],
      })
      expect(stopped?.stopRequestedAt).toEqual(now)
    } finally {
      await deleteUser(ownerId)
    }
  })

  it("Artifact 分配单调 changeSequence，feedback 只接受合格 assistant", async () => {
    const ownerId = await createUser()
    try {
      const { project, root } = await createProjectWithRoot(ownerId)
      const { assistant, user } = await unitOfWork.transaction(
        async (repositories) => {
          const user = await repositories.messages.append({
            actorId: ownerId,
            id: randomUUID(),
            threadId: root.id,
            role: "user",
            parts: [{ type: "text", text: "用户" }],
            finalizedAt: now,
          })
          const assistant = await repositories.messages.append({
            actorId: ownerId,
            id: randomUUID(),
            threadId: root.id,
            role: "assistant",
            parts: [{ type: "text", text: "回答" }],
            finalizedAt: now,
          })
          const queued = await repositories.messageRuns.insertQueued({
            actorId: ownerId,
            id: randomUUID(),
            assistantMessageId: assistant.id,
            modelId: "fake/test-model",
          })
          await repositories.messageRuns.transition({
            actorId: ownerId,
            messageRunId: queued.id,
            expectedStatus: "queued",
            nextStatus: "running",
          })
          await repositories.messageRuns.transition({
            actorId: ownerId,
            messageRunId: queued.id,
            expectedStatus: "running",
            nextStatus: "completed",
            finishedAt: now,
          })
          return { assistant, user }
        }
      )

      const artifacts = await unitOfWork.transaction(async (repositories) => [
        await repositories.artifacts.insert({
          actorId: ownerId,
          id: randomUUID(),
          projectId: project.id,
          sourceMessageId: assistant.id,
          kind: "markdown",
          title: "A",
          content: "# A",
        }),
        await repositories.artifacts.insert({
          actorId: ownerId,
          id: randomUUID(),
          projectId: project.id,
          sourceMessageId: assistant.id,
          kind: "markdown",
          title: "B",
          content: "# B",
        }),
      ])
      expect(artifacts.map((artifact) => artifact.changeSequence)).toEqual([
        1, 2,
      ])
      expect(
        await unitOfWork.transaction((repositories) =>
          repositories.feedback.set({
            actorId: ownerId,
            assistantMessageId: assistant.id,
            feedback: "positive",
          })
        )
      ).toBe("positive")
      await expect(
        unitOfWork.transaction((repositories) =>
          repositories.feedback.set({
            actorId: ownerId,
            assistantMessageId: user.id,
            feedback: "positive",
          })
        )
      ).rejects.toMatchObject({ code: "feedback_not_eligible" })
    } finally {
      await deleteUser(ownerId)
    }
  })
})
