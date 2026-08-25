import { isExplicitMarkdownArtifactRequest } from "@/lib/chat/markdown-artifact"
import type {
  AiRuntime,
  AiRuntimeEvent,
  AiRuntimeRequest,
} from "../application/ports/ai-runtime"

const ISOLATED_TEST_DATABASE_NAME = "thread-chat-test"

export function usesIsolatedTestAiRuntime(input: {
  databaseUrl: string | undefined
  nodeEnv: string | undefined
}): boolean {
  if (input.nodeEnv === "production" || !input.databaseUrl) return false
  try {
    const url = new URL(input.databaseUrl)
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      decodeURIComponent(url.pathname.slice(1)) === ISOLATED_TEST_DATABASE_NAME
    )
  } catch {
    return false
  }
}

function waitForDelayOrAbort(
  delayMs: number,
  signal: AbortSignal | undefined
): Promise<"elapsed" | "aborted"> {
  if (signal?.aborted) return Promise.resolve("aborted")
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve("elapsed")
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      resolve("aborted")
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * 只在 allowlisted `thread-chat-test` 数据库 + 非 production 进程启用。
 * 它不是产品 feature flag：无法通过任意环境变量切换，也不会在正式数据库上运行。
 */
export class IsolatedTestAiRuntime implements AiRuntime {
  constructor(
    private readonly delays: {
      normalMs: number
      slowMs: number
      stopTimeoutMs: number
    } = { normalMs: 120, slowMs: 2_500, stopTimeoutMs: 30_000 }
  ) {}

  async *execute(
    request: AiRuntimeRequest,
    options: { signal?: AbortSignal } = {}
  ): AsyncIterable<AiRuntimeEvent> {
    const prompt = request.prompt
      .findLast((message) => message.role === "user")
      ?.parts.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim() ?? ""
    const response = `测试回复 ${request.assistantMessageId.slice(-6)}：已收到「${prompt}」。`

    yield {
      type: "delta",
      partsDelta: [{ type: "text", text: "测试回复生成中…" }],
    }

    const stopScenario = prompt.includes("直到我停止")
    const slowScenario = prompt.includes("刷新恢复")
    const waitResult = await waitForDelayOrAbort(
      stopScenario
        ? this.delays.stopTimeoutMs
        : slowScenario
          ? this.delays.slowMs
          : this.delays.normalMs,
      options.signal
    )
    if (waitResult === "aborted") {
      yield { type: "stopped" }
      return
    }

    if (isExplicitMarkdownArtifactRequest(prompt)) {
      yield {
        type: "artifact",
        output: {
          kind: "markdown",
          title: "E2E Markdown",
          content:
            "# E2E Markdown\n\n- Artifact 按 ID 加载\n- 来源 Message 可定位\n- 刷新后可恢复",
          toolCallId: `e2e-${request.messageRunId}`,
        },
      }
    }

    yield {
      type: "completed",
      parts: [{ type: "text", text: response }],
    }
  }
}
