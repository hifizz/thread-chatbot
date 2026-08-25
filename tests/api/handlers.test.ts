import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ after: vi.fn() }))

import { dbClient } from "@/lib/db"
import {
  creationBundleSchema,
  messageCreationBundleSchema,
  projectBootstrapSchema,
  replacementBundleSchema,
  threadMessageBundleSchema,
} from "@/lib/thread-chat/api/contracts"
import {
  bootstrapProject,
  createProject,
  deleteProject,
  editMessage,
  forkThread,
  listProjects,
  loadArtifact,
  loadThreadMessages,
  patchProject,
  patchThread,
  regenerateMessage,
  sendMessage,
  setFeedback,
  setProjectArchived,
  setThreadArchived,
  stopAssistant,
} from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"
import {
  createThreadChatRepositories,
  ThreadChatUnitOfWork,
} from "@/lib/thread-chat/infrastructure/repositories"

const unitOfWork = new ThreadChatUnitOfWork(dbClient)

async function createUser(): Promise<string> {
  const id = randomUUID()
  await dbClient`
    insert into thread_chat."user" (
      id, name, email, email_verified, created_at, updated_at
    ) values (
      ${id}, 'API Test', ${`${id}@thread-chat.test`}, true, now(), now()
    )
  `
  return id
}

async function deleteUser(id: string): Promise<void> {
  await dbClient`delete from thread_chat."user" where id = ${id}`
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function call(
  actorId: string | null,
  action: (actorId: string) => Promise<Response>,
  fallback: Parameters<typeof withActor>[1] = "internal_error"
) {
  return withActor(action, fallback, async () => actorId)
}

async function data(response: Response) {
  return (await response.json()).data
}

async function errorCode(response: Response) {
  return (await response.json()).error.code as string
}

async function aggregateCounts(actorId: string) {
  const [row] = await dbClient<
    { projects: number; threads: number; messages: number; runs: number }[]
  >`
    select
      count(distinct p.id)::integer as projects,
      count(distinct t.id)::integer as threads,
      count(distinct m.id)::integer as messages,
      count(distinct r.id)::integer as runs
    from thread_chat.projects p
    left join thread_chat.threads t on t.project_id = p.id
    left join thread_chat.messages m on m.thread_id = t.id
    left join thread_chat.message_runs r on r.assistant_message_id = m.id
    where p.owner_user_id = ${actorId}
  `
  return row
}

async function completeAssistant(
  actorId: string,
  assistantMessageId: string,
  parts: Array<Record<string, unknown>> = [{ type: "text", text: "completed" }]
) {
  const repositories = createThreadChatRepositories(dbClient)
  const run = await repositories.messageRuns.findOwnedByAssistantMessageId(
    actorId,
    assistantMessageId
  )
  await repositories.messageRuns.transition({
    actorId,
    messageRunId: run!.id,
    expectedStatus: "queued",
    nextStatus: "running",
  })
  await repositories.messages.finalizeAssistantOnce({
    actorId,
    messageId: assistantMessageId,
    parts: parts as never,
    finalizedAt: new Date(),
  })
  await repositories.messageRuns.transition({
    actorId,
    messageRunId: run!.id,
    expectedStatus: "running",
    nextStatus: "completed",
    finishedAt: new Date(),
    incrementEventSequence: true,
  })
}

describe("ThreadChat API handlers", () => {
  it("Session、严格输入、Project cursor 与 owner scope 使用统一合同", async () => {
    const actorId = await createUser()
    const otherId = await createUser()
    try {
      const unauthorized = await call(null, (actor) =>
        listProjects(actor, new Request("http://test/api/v1/projects"))
      )
      expect(unauthorized.status).toBe(401)

      const invalid = await call(actorId, (actor) =>
        createProject(
          actor,
          jsonRequest("http://test/api/v1/projects", "POST", {
            initialMessage: { parts: [{ type: "text", text: "valid" }] },
            clientProjectId: randomUUID(),
          })
        )
      )
      expect(invalid.status).toBe(400)
      expect((await invalid.json()).error.code).toBe("validation_error")

      const creations: Array<ReturnType<typeof creationBundleSchema.parse>> = []
      for (const text of ["one", "two", "three"]) {
        const response = await call(actorId, (actor) =>
          createProject(
            actor,
            jsonRequest("http://test/api/v1/projects", "POST", {
              initialMessage: { parts: [{ type: "text", text }] },
            })
          )
        )
        expect(response.status).toBe(201)
        const creation = creationBundleSchema.parse(await data(response))
        expect(JSON.stringify(creation)).not.toContain("canonicalUrl")
        creations.push(creation)
      }

      const firstPage = await data(
        await call(actorId, (actor) =>
          listProjects(
            actor,
            new Request("http://test/api/v1/projects?limit=2&status=active")
          )
        )
      )
      expect(firstPage.items).toHaveLength(2)
      expect(firstPage.nextCursor).toEqual(expect.any(String))
      const secondPage = await data(
        await call(actorId, (actor) =>
          listProjects(
            actor,
            new Request(
              `http://test/api/v1/projects?limit=2&status=active&cursor=${encodeURIComponent(firstPage.nextCursor)}`
            )
          )
        )
      )
      expect(secondPage.items).toHaveLength(1)
      expect(
        new Set(
          [...firstPage.items, ...secondPage.items].map((item) => item.id)
        ).size
      ).toBe(3)
      const rebound = await call(actorId, (actor) =>
        listProjects(
          actor,
          new Request(
            `http://test/api/v1/projects?status=archived&cursor=${encodeURIComponent(firstPage.nextCursor)}`
          )
        )
      )
      expect(rebound.status).toBe(400)
      expect((await rebound.json()).error.code).toBe("invalid_cursor")

      const forbidden = await call(
        otherId,
        (actor) => bootstrapProject(actor, creations[0].project.id),
        "project_not_found"
      )
      expect(forbidden.status).toBe(404)
      expect((await forbidden.json()).error.code).toBe("project_not_found")
    } finally {
      await deleteUser(actorId)
      await deleteUser(otherId)
    }
  })

  it("Query 边界与失败 Command 返回合同错误且不留下半成品", async () => {
    const actorId = await createUser()
    try {
      expect(
        await data(
          await call(actorId, (actor) =>
            listProjects(actor, new Request("http://test/api/v1/projects"))
          )
        )
      ).toEqual({ items: [], nextCursor: null })

      const duplicateQuery = await call(actorId, (actor) =>
        listProjects(
          actor,
          new Request("http://test/api/v1/projects?limit=2&limit=3")
        )
      )
      expect(duplicateQuery.status).toBe(400)
      expect(await errorCode(duplicateQuery)).toBe("invalid_query")

      const invalidModel = await call(actorId, (actor) =>
        createProject(
          actor,
          jsonRequest("http://test/api/v1/projects", "POST", {
            initialMessage: {
              parts: [{ type: "text", text: "invalid model" }],
            },
            requestedModelId: "not/available",
          })
        )
      )
      expect(invalidModel.status).toBe(422)
      expect(await errorCode(invalidModel)).toBe("model_not_available")
      expect(await aggregateCounts(actorId)).toEqual({
        projects: 0,
        threads: 0,
        messages: 0,
        runs: 0,
      })

      const creation = creationBundleSchema.parse(
        await data(
          await call(actorId, (actor) =>
            createProject(
              actor,
              jsonRequest("http://test/api/v1/projects", "POST", {
                initialMessage: { parts: [{ type: "text", text: "queued" }] },
              })
            )
          )
        )
      )
      const before = await aggregateCounts(actorId)

      const sendConflict = await call(actorId, (actor) =>
        sendMessage(
          actor,
          creation.rootThread.id,
          jsonRequest("http://test/messages", "POST", {
            parts: [{ type: "text", text: "must rollback" }],
          })
        )
      )
      expect(sendConflict.status).toBe(409)
      expect(await errorCode(sendConflict)).toBe(
        "thread_generation_in_progress"
      )

      const forkConflict = await call(actorId, (actor) =>
        forkThread(
          actor,
          creation.rootThread.id,
          jsonRequest("http://test/forks", "POST", {
            sourceMessageId: creation.assistantMessage.id,
          })
        )
      )
      expect(forkConflict.status).toBe(422)
      expect(await errorCode(forkConflict)).toBe("fork_source_not_finalized")

      const rootTitle = await call(actorId, (actor) =>
        patchThread(
          actor,
          creation.rootThread.id,
          jsonRequest("http://test/thread", "PATCH", { customTitle: "Root" })
        )
      )
      expect(rootTitle.status).toBe(422)
      expect(await errorCode(rootTitle)).toBe(
        "root_thread_title_owned_by_project"
      )
      const rootArchive = await call(actorId, (actor) =>
        setThreadArchived(actor, creation.rootThread.id, true)
      )
      expect(rootArchive.status).toBe(422)
      expect(await errorCode(rootArchive)).toBe(
        "root_thread_archive_owned_by_project"
      )

      const feedbackConflict = await call(actorId, (actor) =>
        setFeedback(
          actor,
          creation.userMessage.id,
          jsonRequest("http://test/feedback", "PUT", { value: "negative" })
        )
      )
      expect(feedbackConflict.status).toBe(422)
      expect(await errorCode(feedbackConflict)).toBe(
        "message_not_feedback_eligible"
      )

      expect(await aggregateCounts(actorId)).toEqual(before)
    } finally {
      await deleteUser(actorId)
    }
  })

  it("Query、metadata、Artifact 与 command 响应保持原子关系", async () => {
    const actorId = await createUser()
    const otherId = await createUser()
    try {
      const creationResponse = await call(actorId, (actor) =>
        createProject(
          actor,
          jsonRequest("http://test/api/v1/projects", "POST", {
            initialMessage: {
              parts: [{ type: "text", text: "create artifact" }],
            },
          })
        )
      )
      const creation = creationBundleSchema.parse(await data(creationResponse))
      const artifact = await unitOfWork.transaction((repositories) =>
        repositories.artifacts.insert({
          actorId,
          id: randomUUID(),
          projectId: creation.project.id,
          sourceMessageId: creation.assistantMessage.id,
          kind: "markdown",
          title: "API Artifact",
          content: "# API Artifact body",
        })
      )
      await completeAssistant(actorId, creation.assistantMessage.id, [
        { type: "text", text: "done" },
        {
          type: "dynamic-tool",
          toolName: "createMarkdownArtifact",
          toolCallId: "tool-api",
          state: "output-available",
          input: { title: "API Artifact" },
          output: { artifactId: artifact.id },
        },
      ])

      const bootstrapResponse = await call(actorId, (actor) =>
        bootstrapProject(actor, creation.project.id)
      )
      const bootstrap = projectBootstrapSchema.parse(
        await data(bootstrapResponse)
      )
      expect(bootstrap.artifactSummary).toEqual({
        changeSequence: 1,
        total: 1,
        byKind: { markdown: 1 },
      })
      expect(JSON.stringify(bootstrap)).not.toContain("# API Artifact body")
      const artifactResponse = await call(actorId, (actor) =>
        loadArtifact(actor, artifact.id)
      )
      expect(await data(artifactResponse)).toMatchObject({
        id: artifact.id,
        content: "# API Artifact body",
      })
      const hiddenArtifact = await call(
        otherId,
        (actor) => loadArtifact(actor, artifact.id),
        "artifact_not_found"
      )
      expect(hiddenArtifact.status).toBe(404)

      const patchResponse = await call(actorId, (actor) =>
        patchProject(
          actor,
          creation.project.id,
          jsonRequest("http://test/project", "PATCH", {
            customTitle: "Patched",
          })
        )
      )
      expect(await data(patchResponse)).toMatchObject({
        customTitle: "Patched",
        target: null,
      })
      expect(
        (
          await data(
            await call(actorId, (actor) =>
              setProjectArchived(actor, creation.project.id, true)
            )
          )
        ).archivedAt
      ).not.toBeNull()
      await call(actorId, (actor) =>
        setProjectArchived(actor, creation.project.id, false)
      )

      const feedback = await call(actorId, (actor) =>
        setFeedback(
          actor,
          creation.assistantMessage.id,
          jsonRequest("http://test/feedback", "PUT", { value: "positive" })
        )
      )
      expect(await data(feedback)).toMatchObject({ value: "positive" })

      const sendResponse = await call(actorId, (actor) =>
        sendMessage(
          actor,
          creation.rootThread.id,
          jsonRequest("http://test/messages", "POST", {
            parts: [{ type: "text", text: "second" }],
          })
        )
      )
      const sent = messageCreationBundleSchema.parse(await data(sendResponse))
      expect(sent.assistantRun.assistantMessageId).toBe(
        sent.assistantMessage.id
      )
      await completeAssistant(actorId, sent.assistantMessage.id)

      const forkResponse = await call(actorId, (actor) =>
        forkThread(
          actor,
          creation.rootThread.id,
          jsonRequest("http://test/forks", "POST", {
            sourceMessageId: sent.assistantMessage.id,
          })
        )
      )
      const branch = (await data(forkResponse)).thread
      expect(branch).toMatchObject({
        parentThreadId: creation.rootThread.id,
        sourceMessageId: sent.assistantMessage.id,
      })
      expect(
        await data(
          await call(actorId, (actor) =>
            patchThread(
              actor,
              branch.id,
              jsonRequest("http://test/thread", "PATCH", {
                customTitle: "Branch",
              })
            )
          )
        )
      ).toMatchObject({ customTitle: "Branch" })
      expect(
        (
          await data(
            await call(actorId, (actor) =>
              setThreadArchived(actor, branch.id, true)
            )
          )
        ).archivedAt
      ).not.toBeNull()

      const invalidFork = await call(actorId, (actor) =>
        forkThread(
          actor,
          creation.rootThread.id,
          jsonRequest("http://test/forks", "POST", {
            sourceMessageId: sent.assistantMessage.id,
            baseContext: { schemaVersion: 1, messageIds: [] },
          })
        )
      )
      expect(invalidFork.status).toBe(400)

      const editResponse = await call(actorId, (actor) =>
        editMessage(
          actor,
          sent.userMessage.id,
          jsonRequest("http://test/edit", "POST", {
            parts: [{ type: "text", text: "second edited" }],
          })
        )
      )
      const edited = replacementBundleSchema.parse(await data(editResponse))
      expect(new Set(edited.supersededMessageIds)).toEqual(
        new Set([sent.userMessage.id, sent.assistantMessage.id])
      )
      await completeAssistant(actorId, edited.createdMessages[1].id)

      const regenerateResponse = await call(actorId, (actor) =>
        regenerateMessage(
          actor,
          edited.createdMessages[1].id,
          jsonRequest("http://test/regenerate", "POST", {})
        )
      )
      const regenerated = replacementBundleSchema.parse(
        await data(regenerateResponse)
      )
      expect(regenerated.createdMessages[0].replacesMessageId).toBe(
        edited.createdMessages[1].id
      )
      const stopped = await call(actorId, (actor) =>
        stopAssistant(actor, regenerated.createdMessages[0].id)
      )
      expect(await data(stopped)).toMatchObject({ status: "stopped" })

      const window = threadMessageBundleSchema.parse(
        await data(
          await call(actorId, (actor) =>
            loadThreadMessages(
              actor,
              creation.rootThread.id,
              new Request("http://test/messages?limit=2")
            )
          )
        )
      )
      expect(window.messages).toHaveLength(2)
      expect(window.hasOlderMessages).toBe(true)
      expect(window.messages[0].sequence).toBeLessThan(
        window.messages[1].sequence
      )

      const deleted = await call(actorId, (actor) =>
        deleteProject(actor, creation.project.id)
      )
      expect(deleted.status).toBe(204)
    } finally {
      await deleteUser(actorId)
      await deleteUser(otherId)
    }
  })
})
