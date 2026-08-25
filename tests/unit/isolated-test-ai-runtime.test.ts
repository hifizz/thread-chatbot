import { describe, expect, it } from "vitest"
import {
  IsolatedTestAiRuntime,
  usesIsolatedTestAiRuntime,
} from "@/lib/thread-chat/infrastructure/isolated-test-ai-runtime"
import type { AiRuntimeRequest } from "@/lib/thread-chat/application/ports/ai-runtime"

function request(text: string): AiRuntimeRequest {
  return {
    messageRunId: "00000000-0000-4000-8000-000000000001",
    assistantMessageId: "00000000-0000-4000-8000-000000000002",
    modelId: "fake/model",
    prompt: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        role: "user",
        parts: [{ type: "text", text }],
      },
    ],
  }
}

describe("IsolatedTestAiRuntime", () => {
  it("仅允许非 production 的 thread-chat-test 数据库启用", () => {
    expect(
      usesIsolatedTestAiRuntime({
        databaseUrl: "postgres://localhost:5432/thread-chat-test",
        nodeEnv: "development",
      })
    ).toBe(true)
    expect(
      usesIsolatedTestAiRuntime({
        databaseUrl: "postgres://localhost:5432/thread-chat-test",
        nodeEnv: "production",
      })
    ).toBe(false)
    expect(
      usesIsolatedTestAiRuntime({
        databaseUrl: "postgres://localhost:5432/thread-chat",
        nodeEnv: "development",
      })
    ).toBe(false)
  })

  it("稳定产生 delta、Artifact 与 completed", async () => {
    const events = []
    for await (const event of new IsolatedTestAiRuntime({
      normalMs: 0,
      slowMs: 0,
      stopTimeoutMs: 0,
    }).execute(request("请生成 Markdown 文档")))
      events.push(event)

    expect(events.map((event) => event.type)).toEqual([
      "delta",
      "artifact",
      "completed",
    ])
    expect(events[1]).toMatchObject({
      type: "artifact",
      output: { title: "E2E Markdown" },
    })
  })

  it("显式 Stop 会终止等待中的运行", async () => {
    const controller = new AbortController()
    const iterator = new IsolatedTestAiRuntime({
      normalMs: 0,
      slowMs: 0,
      stopTimeoutMs: 30_000,
    })
      .execute(request("请持续生成，直到我停止"), {
        signal: controller.signal,
      })
      [Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "delta" },
    })
    const terminal = iterator.next()
    controller.abort()
    await expect(terminal).resolves.toMatchObject({
      value: { type: "stopped" },
      done: false,
    })
  })
})
