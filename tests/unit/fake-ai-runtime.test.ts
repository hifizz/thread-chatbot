import { describe, expect, it } from "vitest"
import { FakeAiRuntime } from "../fakes/fake-ai-runtime"

const request = {
  messageRunId: "run-1",
  assistantMessageId: "assistant-1",
  modelId: "fake/test-model",
  prompt: [],
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

describe("FakeAiRuntime", () => {
  it("按脚本输出 delta、Artifact 与 completed", async () => {
    const runtime = new FakeAiRuntime()
    runtime.setScenario(request.messageRunId, {
      events: [
        {
          type: "delta",
          partsDelta: [{ type: "text", text: "第一段" }],
        },
        {
          type: "artifact",
          output: { kind: "markdown", title: "文档", content: "# 文档" },
        },
        {
          type: "completed",
          parts: [{ type: "text", text: "完成" }],
        },
      ],
    })

    const events = await collect(runtime.execute(request))

    expect(events.map((event) => event.type)).toEqual([
      "delta",
      "artifact",
      "completed",
    ])
    expect(runtime.invocations).toEqual([request])
  })

  it("支持 failed、stopped 和按 eventSequence 恢复事件", async () => {
    const runtime = new FakeAiRuntime()
    runtime.setScenario(request.messageRunId, {
      events: [
        { type: "delta", partsDelta: [] },
        { type: "failed", error: { code: "provider_error", message: "失败" } },
      ],
    })

    expect(runtime.recoveryEventsAfter(request.messageRunId, 1)).toEqual([
      {
        eventSequence: 2,
        event: {
          type: "failed",
          error: { code: "provider_error", message: "失败" },
        },
      },
    ])

    const controller = new AbortController()
    controller.abort()
    expect(
      await collect(runtime.execute(request, { signal: controller.signal }))
    ).toEqual([{ type: "stopped" }])
  })
})
