import type {
  AiRuntime,
  AiRuntimeEvent,
  AiRuntimeRequest,
} from "@/lib/thread-chat/application/ports/ai-runtime"

export type FakeAiRuntimeScenario = {
  events: AiRuntimeEvent[]
}

export type FakeAiRuntimeRecoveryEvent = {
  eventSequence: number
  event: AiRuntimeEvent
}

/** 可控且不访问网络的 AI Runtime；测试脚本决定全部 delta、工具与终态。 */
export class FakeAiRuntime implements AiRuntime {
  readonly invocations: AiRuntimeRequest[] = []
  private readonly scenarios = new Map<string, FakeAiRuntimeScenario>()

  setScenario(messageRunId: string, scenario: FakeAiRuntimeScenario): void {
    this.scenarios.set(messageRunId, structuredClone(scenario))
  }

  async *execute(
    request: AiRuntimeRequest,
    options: { signal?: AbortSignal } = {}
  ): AsyncIterable<AiRuntimeEvent> {
    this.invocations.push(structuredClone(request))
    const scenario = this.scenarios.get(request.messageRunId)
    if (!scenario) {
      yield {
        type: "failed",
        error: {
          code: "fake_scenario_missing",
          message: `未配置 MessageRun ${request.messageRunId} 的 Fake 场景。`,
        },
      }
      return
    }

    for (const event of scenario.events) {
      if (options.signal?.aborted) {
        yield { type: "stopped" }
        return
      }
      yield structuredClone(event)
    }
  }

  /** 为恢复流测试生成稳定游标，并只返回指定游标之后的事件。 */
  recoveryEventsAfter(
    messageRunId: string,
    afterEventSequence: number
  ): FakeAiRuntimeRecoveryEvent[] {
    const events = this.scenarios.get(messageRunId)?.events ?? []
    return events
      .map((event, index) => ({ eventSequence: index + 1, event }))
      .filter((entry) => entry.eventSequence > afterEventSequence)
      .map((entry) => structuredClone(entry))
  }
}
