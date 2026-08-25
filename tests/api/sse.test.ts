import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ after: vi.fn() }))

import { dbClient } from "@/lib/db"
import { assistantMessageEventSchema } from "@/lib/thread-chat/api/contracts"
import {
  assistantEvents,
  createProject,
  stopAssistant,
} from "@/lib/thread-chat/api/server/handlers"
import { withActor } from "@/lib/thread-chat/api/server/http"
import { createThreadChatRepositories } from "@/lib/thread-chat/infrastructure/repositories"

async function createUser(): Promise<string> {
  const id = randomUUID()
  await dbClient`
    insert into thread_chat."user" (
      id, name, email, email_verified, created_at, updated_at
    ) values (
      ${id}, 'SSE Test', ${`${id}@thread-chat.test`}, true, now(), now()
    )
  `
  return id
}

async function deleteUser(id: string): Promise<void> {
  await dbClient`delete from thread_chat."user" where id = ${id}`
}

async function createQueued(actorId: string) {
  const response = await withActor(
    (actor) =>
      createProject(
        actor,
        new Request("http://test/api/v1/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            initialMessage: { parts: [{ type: "text", text: "SSE" }] },
          }),
        })
      ),
    "internal_error",
    async () => actorId
  )
  return (await response.json()).data
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value, done } = await reader.read()
  expect(done).toBe(false)
  const block = new TextDecoder().decode(value)
  const line = block.split("\n").find((entry) => entry.startsWith("data:"))
  return assistantMessageEventSchema.parse(JSON.parse(line!.slice(5).trim()))
}

describe("ThreadChat SSE", () => {
  it("snapshot、delta cursor、completed、重连与重复连接复用同一 Run", async () => {
    const actorId = await createUser()
    try {
      const creation = await createQueued(actorId)
      const repositories = createThreadChatRepositories(dbClient)
      const queued =
        await repositories.messageRuns.findOwnedByAssistantMessageId(
          actorId,
          creation.assistantMessage.id
        )
      await repositories.messageRuns.transition({
        actorId,
        messageRunId: queued!.id,
        expectedStatus: "queued",
        nextStatus: "running",
      })
      await repositories.messageRuns.checkpoint({
        actorId,
        messageRunId: queued!.id,
        expectedEventSequence: 0,
        checkpointParts: [{ type: "text", text: "partial" }],
        heartbeatAt: new Date(),
      })

      const firstResponse = await assistantEvents(
        actorId,
        creation.assistantMessage.id,
        new Request("http://test/events?afterEventSequence=0")
      )
      const firstReader = firstResponse.body!.getReader()
      expect(await readEvent(firstReader)).toMatchObject({
        type: "run.snapshot",
        cursor: 1,
        run: {
          assistantMessageId: creation.assistantMessage.id,
          checkpointParts: [{ type: "text", text: "partial" }],
        },
      })
      await firstReader.cancel()
      expect(
        await repositories.messageRuns.findOwnedByAssistantMessageId(
          actorId,
          creation.assistantMessage.id
        )
      ).toMatchObject({ status: "running" })

      const responseA = await assistantEvents(
        actorId,
        creation.assistantMessage.id,
        new Request("http://test/events?afterEventSequence=1")
      )
      const responseB = await assistantEvents(
        actorId,
        creation.assistantMessage.id,
        new Request("http://test/events?afterEventSequence=1")
      )
      const readerA = responseA.body!.getReader()
      const readerB = responseB.body!.getReader()
      expect((await readEvent(readerA)).type).toBe("run.snapshot")
      expect((await readEvent(readerB)).type).toBe("run.snapshot")

      await repositories.messages.finalizeAssistantOnce({
        actorId,
        messageId: creation.assistantMessage.id,
        parts: [{ type: "text", text: "final" }],
        finalizedAt: new Date(),
      })
      await repositories.messageRuns.transition({
        actorId,
        messageRunId: queued!.id,
        expectedStatus: "running",
        nextStatus: "completed",
        finishedAt: new Date(),
        incrementEventSequence: true,
      })
      expect(await readEvent(readerA)).toMatchObject({
        type: "run.completed",
        eventSequence: 2,
        message: { parts: [{ type: "text", text: "final" }] },
      })
      expect(await readEvent(readerB)).toMatchObject({
        type: "run.completed",
        eventSequence: 2,
      })

      const reconnect = await assistantEvents(
        actorId,
        creation.assistantMessage.id,
        new Request("http://test/events?afterEventSequence=1")
      )
      const reconnectReader = reconnect.body!.getReader()
      expect(await readEvent(reconnectReader)).toMatchObject({
        type: "run.snapshot",
        cursor: 2,
        run: { status: "completed" },
      })
      expect((await reconnectReader.read()).done).toBe(true)

      const [count] = await dbClient<{ count: number }[]>`
        select count(*)::integer as count
        from thread_chat.message_runs
        where assistant_message_id = ${creation.assistantMessage.id}
      `
      expect(count.count).toBe(1)
    } finally {
      await deleteUser(actorId)
    }
  })

  it("拒绝超前 cursor，并发送 live failed 与 stopped 终态", async () => {
    const actorId = await createUser()
    try {
      const failedCreation = await createQueued(actorId)
      const repositories = createThreadChatRepositories(dbClient)
      const failedRun =
        await repositories.messageRuns.findOwnedByAssistantMessageId(
          actorId,
          failedCreation.assistantMessage.id
        )
      const invalid = await withActor(
        (actor) =>
          assistantEvents(
            actor,
            failedCreation.assistantMessage.id,
            new Request("http://test/events?afterEventSequence=99")
          ),
        "assistant_message_not_found",
        async () => actorId
      )
      expect(invalid.status).toBe(409)
      expect((await invalid.json()).error.code).toBe("invalid_event_cursor")

      await repositories.messageRuns.transition({
        actorId,
        messageRunId: failedRun!.id,
        expectedStatus: "queued",
        nextStatus: "running",
      })
      const failedResponse = await assistantEvents(
        actorId,
        failedCreation.assistantMessage.id,
        new Request("http://test/events")
      )
      const failedReader = failedResponse.body!.getReader()
      expect((await readEvent(failedReader)).type).toBe("run.snapshot")
      await repositories.messageRuns.transition({
        actorId,
        messageRunId: failedRun!.id,
        expectedStatus: "running",
        nextStatus: "failed",
        error: { code: "provider_failed", message: "failed" },
        finishedAt: new Date(),
        incrementEventSequence: true,
      })
      expect(await readEvent(failedReader)).toMatchObject({
        type: "run.failed",
        eventSequence: 1,
        run: { status: "failed" },
      })

      const stoppedCreation = await createQueued(actorId)
      const stoppedResponse = await assistantEvents(
        actorId,
        stoppedCreation.assistantMessage.id,
        new Request("http://test/events")
      )
      const stoppedReader = stoppedResponse.body!.getReader()
      expect((await readEvent(stoppedReader)).type).toBe("run.snapshot")
      await stopAssistant(actorId, stoppedCreation.assistantMessage.id)
      expect(await readEvent(stoppedReader)).toMatchObject({
        type: "run.stopped",
        eventSequence: 1,
        run: { status: "stopped" },
      })
    } finally {
      await deleteUser(actorId)
    }
  })
})
