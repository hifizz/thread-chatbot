import { describe, expect, it, vi } from "vitest"
import { JsonThreadChatTransport } from "@/lib/thread-chat/api/json-transport"
import { ThreadChatClientError } from "@/lib/thread-chat/api/client-error"
import {
  assistantMessageDTOFixture,
  assistantRunDTOFixture,
} from "../fixtures/thread-chat-api-fixtures"

describe("JsonThreadChatTransport", () => {
  it("默认 fetch 绑定 globalThis，浏览器调用不会 Illegal invocation", async () => {
    const nativeLikeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation")
      return Promise.resolve(
        Response.json({ data: { items: [], nextCursor: null } })
      )
    })
    vi.stubGlobal("fetch", nativeLikeFetch)
    try {
      await expect(new JsonThreadChatTransport().listProjects()).resolves.toEqual(
        { items: [], nextCursor: null }
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("编码请求并严格校验成功响应", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: {
          items: [],
          nextCursor: null,
        },
      })
    )
    const transport = new JsonThreadChatTransport(fetcher)
    expect(
      await transport.listProjects({ status: "archived", limit: 10 })
    ).toEqual({ items: [], nextCursor: null })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects?status=archived&limit=10",
      expect.objectContaining({ credentials: "same-origin" })
    )

    fetcher.mockResolvedValueOnce(
      Response.json({ data: { items: [], nextCursor: null, unknown: true } })
    )
    await expect(transport.listProjects()).rejects.toThrow()
  })

  it("将结构化错误映射为 ClientError", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "project_not_found",
            message: "missing",
          },
        },
        { status: 404 }
      )
    )
    await expect(
      new JsonThreadChatTransport(fetcher).bootstrapProject(crypto.randomUUID())
    ).rejects.toEqual(
      expect.objectContaining<Partial<ThreadChatClientError>>({
        code: "project_not_found",
        status: 404,
        message: "missing",
      })
    )
  })

  it("按 SSE data frame 解析并校验事件", async () => {
    const events = [
      {
        type: "run.snapshot",
        cursor: 0,
        run: assistantRunDTOFixture,
        message: assistantMessageDTOFixture,
        artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
      },
      {
        type: "run.stopped",
        eventSequence: 1,
        run: {
          ...assistantRunDTOFixture,
          status: "stopped",
          eventSequence: 1,
          stopRequestedAt: "2026-08-25T00:00:00.000Z",
          finishedAt: "2026-08-25T00:00:00.000Z",
        },
        message: assistantMessageDTOFixture,
      },
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        for (const event of events)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          )
        controller.close()
      },
    })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      })
    )
    const received = []
    for await (const event of new JsonThreadChatTransport(
      fetcher
    ).subscribeAssistantEvents({
      assistantMessageId: assistantMessageDTOFixture.id,
    })) {
      received.push(event)
    }
    expect(received).toEqual(events)
  })
})
