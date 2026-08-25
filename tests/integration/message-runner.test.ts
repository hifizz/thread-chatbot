import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import postgres from "postgres"
import { MessageRunner } from "@/lib/thread-chat/application/message-runner"
import type {
  AiRuntime,
  AiRuntimeRequest,
} from "@/lib/thread-chat/application/ports/ai-runtime"
import { ThreadChatCommands } from "@/lib/thread-chat/application/thread-chat-commands"
import {
  createThreadChatRepositories,
  ThreadChatUnitOfWork,
} from "@/lib/thread-chat/infrastructure/repositories"
import { FakeAiRuntime } from "../fakes/fake-ai-runtime"
import { assertSafeTestDatabaseUrl } from "../../scripts/lib/test-database-safety.mjs"

const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
const sql = postgres(testDatabaseUrl, { max: 10 })
const unitOfWork = new ThreadChatUnitOfWork(sql)
const now = new Date("2026-08-25T01:00:00.000Z")

function createCommands(
  overrides: {
    wakeRunAfterCommit?: (messageRunId: string) => void | Promise<void>
    onWakeError?: (error: unknown) => void
  } = {}
) {
  return new ThreadChatCommands(unitOfWork, {
    generateId: randomUUID,
    now: () => now,
    resolveModelId: () => "fake/model",
    ...overrides,
  })
}

function createRunner(runtime: AiRuntime) {
  return new MessageRunner(sql, unitOfWork, runtime, {
    generateId: randomUUID,
    now: () => now,
    heartbeatIntervalMs: 60_000,
  })
}

async function createUser(): Promise<string> {
  const id = randomUUID()
  await sql`
    insert into thread_chat."user" (
      id, name, email, email_verified, created_at, updated_at
    ) values (
      ${id}, 'Runner Test', ${`${id}@thread-chat.test`}, true, now(), now()
    )
  `
  return id
}

async function deleteUser(id: string): Promise<void> {
  await sql`delete from thread_chat."user" where id = ${id}`
}

afterAll(async () => {
  await sql.end()
})

describe("MessageRunner", () => {
  it("条件领取、checkpoint、Artifact 引用与 completed 在持久层收敛", async () => {
    const actorId = await createUser()
    try {
      const creation = await createCommands().createProject({
        actorId,
        parts: [{ type: "text", text: "生成 Markdown 文档" }],
      })
      const runtime = new FakeAiRuntime()
      runtime.setScenario(creation.assistantRun.id, {
        events: [
          {
            type: "delta",
            partsDelta: [{ type: "text", text: "working" }],
          },
          {
            type: "artifact",
            output: {
              kind: "markdown",
              title: "Result",
              content: "# Result",
              toolCallId: "tool-call-1",
            },
          },
          {
            type: "completed",
            parts: [{ type: "text", text: "done" }],
          },
        ],
      })
      const runner = createRunner(runtime)
      const [first, duplicate] = await Promise.all([
        runner.execute(creation.assistantRun.id),
        runner.execute(creation.assistantRun.id),
      ])
      expect([first.outcome, duplicate.outcome].toSorted()).toEqual([
        "completed",
        "not_claimed",
      ])
      expect(runtime.invocations).toHaveLength(1)

      const repositories = createThreadChatRepositories(sql)
      const run = await repositories.messageRuns.findOwnedByAssistantMessageId(
        actorId,
        creation.assistantMessage.id
      )
      expect(run).toMatchObject({
        status: "completed",
        eventSequence: 3,
        checkpointParts: [
          { type: "text", text: "working" },
          {
            type: "dynamic-tool",
            toolName: "createMarkdownArtifact",
            toolCallId: "tool-call-1",
            state: "output-available",
            input: { title: "Result" },
            output: { artifactId: expect.any(String) },
          },
        ],
        heartbeatAt: now,
        finishedAt: now,
      })
      const message = await repositories.messages.findOwnedById(
        actorId,
        creation.assistantMessage.id
      )
      expect(message?.finalizedAt).toEqual(now)
      const toolPart = message?.parts?.find(
        (part) => part.type === "dynamic-tool"
      )
      expect(toolPart).toMatchObject({
        output: { artifactId: expect.any(String) },
      })
      const artifactId = (toolPart as { output: { artifactId: string } }).output
        .artifactId
      expect(
        (toolPart as { output: { artifactId: string } }).output
      ).toEqual({ artifactId })
      expect(JSON.stringify(toolPart)).not.toContain("# Result")
      expect(
        await repositories.artifacts.findOwnedById(actorId, artifactId)
      ).toMatchObject({
        sourceMessageId: creation.assistantMessage.id,
        content: "# Result",
      })
      expect(runtime.invocations[0].prompt.map((message) => message.id)).toEqual([
        creation.userMessage.id,
      ])
    } finally {
      await deleteUser(actorId)
    }
  })

  it("queued scanner 补偿唤醒失败并保存 failed 终态", async () => {
    const actorId = await createUser()
    try {
      const wakeErrors: unknown[] = []
      let committedAtWake = false
      const runtime = new FakeAiRuntime()
      const commands = createCommands({
        wakeRunAfterCommit: async (messageRunId) => {
          committedAtWake = Boolean(
            await createThreadChatRepositories(
              sql
            ).messageRuns.findExecutionContext(messageRunId)
          )
          runtime.setScenario(messageRunId, {
            events: [
              {
                type: "failed",
                error: { code: "provider_failed", message: "provider down" },
              },
            ],
          })
          throw new Error("wake unavailable")
        },
        onWakeError: (error) => wakeErrors.push(error),
      })
      const creation = await commands.createProject({
        actorId,
        parts: [{ type: "text", text: "scanner" }],
      })
      expect(wakeErrors).toHaveLength(1)
      expect(committedAtWake).toBe(true)
      expect(creation.assistantRun.status).toBe("queued")

      const scan = await createRunner(runtime).scanQueued()
      expect(scan).toHaveLength(1)
      const run = await createThreadChatRepositories(
        sql
      ).messageRuns.findOwnedByAssistantMessageId(
        actorId,
        creation.assistantMessage.id
      )
      expect(run).toMatchObject({
        status: "failed",
        errorCode: "provider_failed",
        errorMessage: "provider down",
        eventSequence: 1,
        finishedAt: now,
      })
    } finally {
      await deleteUser(actorId)
    }
  })

  it("显式 Stop 终止 queued Run，且不启动 Runtime", async () => {
    const actorId = await createUser()
    try {
      const creation = await createCommands().createProject({
        actorId,
        parts: [{ type: "text", text: "stop queued" }],
      })
      const runtime = new FakeAiRuntime()
      const runner = createRunner(runtime)
      const stopped = await runner.requestStop({
        actorId,
        assistantMessageId: creation.assistantMessage.id,
      })
      expect(stopped).toMatchObject({
        status: "stopped",
        stopRequestedAt: now,
        finishedAt: now,
        eventSequence: 1,
      })
      expect(await runner.execute(creation.assistantRun.id)).toEqual({
        outcome: "not_claimed",
      })
      expect(runtime.invocations).toEqual([])
    } finally {
      await deleteUser(actorId)
    }
  })

  it("running Run 只在显式 Stop 后中止；执行器取消与浏览器订阅无关", async () => {
    const actorId = await createUser()
    try {
      let releaseStarted!: () => void
      const started = new Promise<void>((resolve) => {
        releaseStarted = resolve
      })
      const blockingRuntime: AiRuntime = {
        async *execute(
          _request: AiRuntimeRequest,
          options?: { signal?: AbortSignal }
        ) {
          yield {
            type: "delta" as const,
            partsDelta: [{ type: "text" as const, text: "partial" }],
          }
          releaseStarted()
          await new Promise<void>((resolve) => {
            options?.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            })
          })
          throw new Error("provider aborted")
        },
      }
      const creation = await createCommands().createProject({
        actorId,
        parts: [{ type: "text", text: "stop running" }],
      })
      const runner = createRunner(blockingRuntime)
      const execution = runner.execute(creation.assistantRun.id)
      await started
      const accepted = await runner.requestStop({
        actorId,
        assistantMessageId: creation.assistantMessage.id,
      })
      expect(accepted).toMatchObject({ status: "running", stopRequestedAt: now })
      expect(await execution).toMatchObject({ outcome: "stopped" })
      const run = await createThreadChatRepositories(
        sql
      ).messageRuns.findOwnedByAssistantMessageId(
        actorId,
        creation.assistantMessage.id
      )
      expect(run).toMatchObject({ status: "stopped", finishedAt: now })
    } finally {
      await deleteUser(actorId)
    }
  })
})
