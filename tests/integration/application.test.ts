import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import postgres from "postgres"
import { ThreadChatCommands } from "@/lib/thread-chat/application/thread-chat-commands"
import { ThreadChatQueries } from "@/lib/thread-chat/application/thread-chat-queries"
import { loadPromptHistory } from "@/lib/thread-chat/application/prompt-history"
import {
  createThreadChatRepositories,
  ThreadChatUnitOfWork,
} from "@/lib/thread-chat/infrastructure/repositories"
import { assertSafeTestDatabaseUrl } from "../../scripts/lib/test-database-safety.mjs"

const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const sql = postgres(testDatabaseUrl, { max: 10 })
const unitOfWork = new ThreadChatUnitOfWork(sql)
const fixedNow = new Date("2026-08-25T00:00:00.000Z")
const commands = new ThreadChatCommands(unitOfWork, {
  generateId: randomUUID,
  now: () => fixedNow,
  resolveModelId: (requested) => requested ?? "test/model",
})
const queries = new ThreadChatQueries(sql)

async function createUser(): Promise<string> {
  const id = randomUUID()
  await sql`
    insert into thread_chat."user" (
      id, name, email, email_verified, created_at, updated_at
    ) values (
      ${id}, 'Application Test', ${`${id}@thread-chat.test`}, true, now(), now()
    )
  `
  return id
}

async function deleteUser(id: string): Promise<void> {
  await sql`delete from thread_chat."user" where id = ${id}`
}

async function completeAssistant(actorId: string, messageId: string) {
  const repositories = createThreadChatRepositories(sql)
  const run = await repositories.messageRuns.findOwnedByAssistantMessageId(
    actorId,
    messageId
  )
  expect(run).not.toBeNull()
  const running = await repositories.messageRuns.transition({
    actorId,
    messageRunId: run!.id,
    expectedStatus: "queued",
    nextStatus: "running",
  })
  expect(running?.status).toBe("running")
  await repositories.messages.finalizeAssistantOnce({
    actorId,
    messageId,
    parts: [{ type: "text", text: `answer:${messageId}` }],
    finalizedAt: fixedNow,
  })
  const completed = await repositories.messageRuns.transition({
    actorId,
    messageRunId: run!.id,
    expectedStatus: "running",
    nextStatus: "completed",
    finishedAt: fixedNow,
  })
  expect(completed?.status).toBe("completed")
}

afterAll(async () => {
  await sql.end()
})

describe("ThreadChat Application", () => {
  it("原子创建与追加 turn，并拒绝同 Thread 的并发 generation", async () => {
    const actorId = await createUser()
    try {
      const creation = await commands.createProject({
        actorId,
        parts: [{ type: "text", text: "first" }],
      })
      expect(creation.userMessage.sequence).toBe(1)
      expect(creation.assistantMessage.sequence).toBe(2)
      expect(creation.assistantRun).toMatchObject({
        assistantMessageId: creation.assistantMessage.id,
        status: "queued",
      })
      await expect(
        commands.sendMessage({
          actorId,
          threadId: creation.rootThread.id,
          parts: [{ type: "text", text: "blocked" }],
        })
      ).rejects.toMatchObject({ code: "thread_generation_in_progress" })
      expect(
        (await queries.threadMessages({ actorId, threadId: creation.rootThread.id }))
          .messages
      ).toHaveLength(2)

      await completeAssistant(actorId, creation.assistantMessage.id)
      const turn = await commands.sendMessage({
        actorId,
        threadId: creation.rootThread.id,
        parts: [{ type: "text", text: "second" }],
        requestedModelId: "test/other-model",
      })
      expect([turn.userMessage.sequence, turn.assistantMessage.sequence]).toEqual([
        3, 4,
      ])
      expect(turn.assistantRun.modelId).toBe("test/other-model")
      expect(
        (await loadPromptHistory(sql, { actorId, threadId: creation.rootThread.id })).map(
          (message) => message.id
        )
      ).toEqual([
        creation.userMessage.id,
        creation.assistantMessage.id,
        turn.userMessage.id,
      ])
    } finally {
      await deleteUser(actorId)
    }
  })

  it("Fork 冻结 BaseContext，Prompt History 不依赖客户端窗口", async () => {
    const actorId = await createUser()
    try {
      const creation = await commands.createProject({
        actorId,
        parts: [{ type: "text", text: "fork me" }],
      })
      await completeAssistant(actorId, creation.assistantMessage.id)
      await expect(
        commands.forkThread({
          actorId,
          sourceThreadId: creation.rootThread.id,
          sourceMessageId: creation.assistantMessage.id,
          anchor: {
            exactQuote: "wrong",
            textPosition: { start: 0, end: 5 },
          },
        })
      ).rejects.toMatchObject({ code: "fork_anchor_mismatch" })
      const branch = await commands.forkThread({
        actorId,
        sourceThreadId: creation.rootThread.id,
        sourceMessageId: creation.assistantMessage.id,
        anchor: { exactQuote: "answer" },
      })
      expect(branch).toMatchObject({
        parentThreadId: creation.rootThread.id,
        sourceMessageId: creation.assistantMessage.id,
        forkSourceSnapshot: { sourceRole: "assistant", sourceSequence: 2 },
      })
      expect(branch.baseContext?.messageIds).toEqual([
        creation.userMessage.id,
        creation.assistantMessage.id,
      ])
      expect(
        (await loadPromptHistory(sql, { actorId, threadId: branch.id })).map(
          (message) => message.id
        )
      ).toEqual(branch.baseContext?.messageIds)
    } finally {
      await deleteUser(actorId)
    }
  })

  it("Edit supersede 有效后缀，Regenerate 保留旧事实并追加 replacement", async () => {
    const actorId = await createUser()
    try {
      const creation = await commands.createProject({
        actorId,
        parts: [{ type: "text", text: "u1" }],
      })
      await completeAssistant(actorId, creation.assistantMessage.id)
      const second = await commands.sendMessage({
        actorId,
        threadId: creation.rootThread.id,
        parts: [{ type: "text", text: "u2" }],
      })
      await completeAssistant(actorId, second.assistantMessage.id)

      const edited = await commands.editLastUser({
        actorId,
        sourceUserMessageId: second.userMessage.id,
        parts: [{ type: "text", text: "u2 edited" }],
      })
      expect(new Set(edited.supersededMessageIds)).toEqual(
        new Set([second.userMessage.id, second.assistantMessage.id])
      )
      expect(edited.createdMessages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ])
      expect(edited.createdMessages[0].replacesMessageId).toBe(
        second.userMessage.id
      )
      await completeAssistant(actorId, edited.createdMessages[1].id)

      const oldAssistant = edited.createdMessages[1]
      const regenerated = await commands.regenerate({
        actorId,
        sourceAssistantMessageId: oldAssistant.id,
      })
      expect(regenerated.supersededMessageIds).toEqual([oldAssistant.id])
      expect(regenerated.createdMessages[0]).toMatchObject({
        role: "assistant",
        replacesMessageId: oldAssistant.id,
      })
      const persistedOld = await createThreadChatRepositories(
        sql
      ).messages.findOwnedById(actorId, oldAssistant.id)
      expect(persistedOld).toMatchObject({
        sequence: oldAssistant.sequence,
        parts: [{ type: "text", text: `answer:${oldAssistant.id}` }],
      })
      expect(persistedOld?.supersededAt).not.toBeNull()
    } finally {
      await deleteUser(actorId)
    }
  })

  it("metadata、archive、feedback、Bootstrap、Artifact Query 与级联删除受 owner scope 保护", async () => {
    const actorId = await createUser()
    const otherId = await createUser()
    try {
      const creation = await commands.createProject({
        actorId,
        parts: [{ type: "text", text: "metadata" }],
      })
      await completeAssistant(actorId, creation.assistantMessage.id)
      const project = await commands.patchProject({
        actorId,
        projectId: creation.project.id,
        patch: { customTitle: "Custom", instruction: "instruction" },
      })
      expect(project).toMatchObject({
        customTitle: "Custom",
        instruction: "instruction",
      })
      await commands.setFeedback({
        actorId,
        assistantMessageId: creation.assistantMessage.id,
        feedback: "positive",
      })
      const branch = await commands.forkThread({
        actorId,
        sourceThreadId: creation.rootThread.id,
        sourceMessageId: creation.assistantMessage.id,
      })
      expect(
        await commands.patchBranch({
          actorId,
          threadId: branch.id,
          customTitle: "Branch",
          archived: true,
        })
      ).toMatchObject({ customTitle: "Branch", archivedAt: fixedNow })
      await expect(
        commands.patchBranch({
          actorId,
          threadId: creation.rootThread.id,
          customTitle: "Root",
        })
      ).rejects.toMatchObject({ code: "root_thread_title_owned_by_project" })
      const artifact = await unitOfWork.transaction((repositories) =>
        repositories.artifacts.insert({
          actorId,
          id: randomUUID(),
          projectId: creation.project.id,
          sourceMessageId: creation.assistantMessage.id,
          kind: "markdown",
          title: "Artifact",
          content: "# body",
        })
      )
      const bootstrap = await queries.projectBootstrap({
        actorId,
        projectId: creation.project.id,
      })
      expect(bootstrap.initialThread.threadId).toBe(creation.rootThread.id)
      expect(bootstrap.artifactSummary).toEqual({
        changeSequence: 1,
        total: 1,
        byKind: { markdown: 1 },
      })
      expect(await queries.artifactById({ actorId, artifactId: artifact.id })).toEqual(
        artifact
      )
      await expect(
        queries.artifactById({ actorId: otherId, artifactId: artifact.id })
      ).rejects.toMatchObject({ code: "entity_not_found" })
      expect((await queries.listProjects({ actorId }))[0].displayTitle).toBe(
        "Custom"
      )
      await commands.setProjectArchived({
        actorId,
        projectId: creation.project.id,
        archived: true,
      })
      expect(await queries.listProjects({ actorId })).toEqual([])
      expect(
        await queries.listProjects({ actorId, status: "archived" })
      ).toHaveLength(1)
      await commands.deleteProject({ actorId, projectId: creation.project.id })
      await expect(
        queries.projectBootstrap({ actorId, projectId: creation.project.id })
      ).rejects.toMatchObject({ code: "entity_not_found" })
    } finally {
      await deleteUser(actorId)
      await deleteUser(otherId)
    }
  })

  it("任一创建失败时不留下 Project 半成品", async () => {
    const missingActorId = randomUUID()
    await expect(
      commands.createProject({
        actorId: missingActorId,
        parts: [{ type: "text", text: "rollback" }],
      })
    ).rejects.toBeTruthy()
    const [row] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from thread_chat.projects
      where owner_user_id = ${missingActorId}
    `
    expect(row.count).toBe(0)
  })
})
