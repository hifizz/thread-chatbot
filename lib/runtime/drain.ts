import {
  RUNTIME_DRAIN_TIMEOUT_MS,
  RUNTIME_TELEMETRY_FLUSH_TIMEOUT_MS,
} from "@/constants/runtime"
import { GENERATION_CANCEL_REASONS } from "@/constants/generation"
import { getInstanceId, getReleaseId } from "@/lib/runtime/instance"
import { getSessionStore } from "@/lib/thread-chat/streaming/session-store"

/**
 * 进程级 drain 状态机。
 *
 * 设计前提：Generation 归属单个进程（SessionStore 在内存里），多实例正确性靠
 * 「readiness 失败 → 入口不再路由新请求」+「持久化 stop/心跳标志」保证，
 * drain 本身只需是进程内事实，不需要集群共识。
 *
 * 两条触发路径：
 * 1. 部署前显式 POST /api/internal/drain（按 machine 定向，排空窗口不限时）；
 * 2. SIGTERM/SIGINT（平台终止窗口 ≤300s，收尾必须 bounded）。
 */

export type DrainState = {
  draining: boolean
  acceptingNewGenerations: boolean
  activeGenerations: number
  activeDeliveries: number
  deadlineAt: string | null
}

type DrainDeps = {
  activeGenerations: () => number
  activeDeliveries: () => number
  abortAll: (
    reason: (typeof GENERATION_CANCEL_REASONS)[keyof typeof GENERATION_CANCEL_REASONS]
  ) => number
  flushTelemetry: () => Promise<void>
  log: (event: string, data?: Record<string, unknown>) => void
  now: () => number
  exit: (code: number) => void
}

type DrainController = {
  begin: (options?: { deadlineMs?: number; abortInFlight?: boolean }) => DrainState
  state: () => DrainState
  isDraining: () => boolean
  /** 等到在途 Generation 归零或超过 deadline；返回是否排空。 */
  waitForQuiesce: (deadlineMs?: number) => Promise<boolean>
  /** 显式中止仍在运行的在途生成（graceful drain 超时后的强制手段）。 */
  abortRemaining: () => number
  installSignalHandlers: () => void
}

const DRAIN_SYMBOL = Symbol.for("thread-chat.runtime.drain.v1")
type DrainGlobal = typeof globalThis & { [DRAIN_SYMBOL]?: DrainController }

function defaultDeps(): DrainDeps {
  return {
    activeGenerations: () => 0,
    activeDeliveries: () => 0,
    abortAll: () => 0,
    flushTelemetry: async () => {},
    log: (event, data) => console.log(`[drain] ${event}`, data ?? ""),
    now: () => Date.now(),
    exit: (code) => process.exit(code),
  }
}

export function createDrainController(
  overrides: Partial<DrainDeps> = {}
): DrainController {
  const deps: DrainDeps = { ...defaultDeps(), ...overrides }
  let draining = false
  let deadlineAt: number | null = null
  let signalsInstalled = false

  const state = (): DrainState => ({
    draining,
    acceptingNewGenerations: !draining,
    activeGenerations: deps.activeGenerations(),
    activeDeliveries: deps.activeDeliveries(),
    deadlineAt: deadlineAt === null ? null : new Date(deadlineAt).toISOString(),
  })

  async function waitForQuiesce(deadlineMs?: number): Promise<boolean> {
    const deadline = deps.now() + (deadlineMs ?? RUNTIME_DRAIN_TIMEOUT_MS)
    while (deps.activeGenerations() > 0 && deps.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return deps.activeGenerations() === 0
  }

  async function shutdown(signal: "SIGTERM" | "SIGINT"): Promise<void> {
    begin({ deadlineMs: RUNTIME_DRAIN_TIMEOUT_MS, abortInFlight: true })
    const quiesced = await waitForQuiesce(RUNTIME_DRAIN_TIMEOUT_MS)
    deps.log("shutdown.drain_result", {
      signal,
      quiesced,
      remainingGenerations: deps.activeGenerations(),
    })
    await Promise.race([
      deps.flushTelemetry(),
      new Promise<void>((resolve) =>
        setTimeout(resolve, RUNTIME_TELEMETRY_FLUSH_TIMEOUT_MS)
      ),
    ])
    deps.exit(signal === "SIGINT" ? 130 : 143)
  }

  function begin(options: { deadlineMs?: number; abortInFlight?: boolean } = {}): DrainState {
    if (!draining) {
      draining = true
      deadlineAt =
        options.deadlineMs === undefined ? null : deps.now() + options.deadlineMs
      // 部署前排空只关准入、让在途任务自然完成；信号收尾才中止在途任务。
      const aborted =
        options.abortInFlight === false
          ? 0
          : deps.abortAll(GENERATION_CANCEL_REASONS.deployDrain)
      deps.log("drain.begin", {
        instanceId: getInstanceId(),
        release: getReleaseId(),
        abortedGenerations: aborted,
        abortInFlight: options.abortInFlight !== false,
        deadlineAt: state().deadlineAt,
      })
    }
    return state()
  }

  return {
    begin,
    state,
    isDraining: () => draining,
    waitForQuiesce,
    abortRemaining: () => {
      const aborted = deps.abortAll(GENERATION_CANCEL_REASONS.deployDrain)
      deps.log("drain.abort_remaining", { abortedGenerations: aborted })
      return aborted
    },
    installSignalHandlers: () => {
      if (signalsInstalled) return
      signalsInstalled = true
      process.once("SIGTERM", () => void shutdown("SIGTERM"))
      process.once("SIGINT", () => void shutdown("SIGINT"))
    },
  }
}

function controller(): DrainController {
  const scope = globalThis as DrainGlobal
  if (!scope[DRAIN_SYMBOL]) {
    scope[DRAIN_SYMBOL] = createDrainController({
      activeGenerations: () => getSessionStore().activeGenerationCount(),
      activeDeliveries: () => getSessionStore().activeSubscriberCount(),
      abortAll: (reason) => getSessionStore().abortAll(reason),
      flushTelemetry: async () => {
        const [{ flushObservability }, { logger }] = await Promise.all([
          import("@/lib/observability/register-node"),
          import("@/lib/axiom/server"),
        ])
        await Promise.allSettled([flushObservability(), logger.flush()])
      },
      log: (event, data) => {
        void import("@/lib/axiom/server")
          .then(({ logger }) => logger.info(`drain.${event}`, data ?? {}))
          .catch(() => console.log(`[drain] ${event}`, data ?? ""))
      },
    })
  }
  return scope[DRAIN_SYMBOL]
}

export const beginDrain: DrainController["begin"] = (options) =>
  controller().begin(options)
export const drainState: DrainController["state"] = () => controller().state()
export const isDraining: DrainController["isDraining"] = () =>
  controller().isDraining()
export const waitForQuiesce: DrainController["waitForQuiesce"] = (deadlineMs) =>
  controller().waitForQuiesce(deadlineMs)
export const abortRemainingGenerations: DrainController["abortRemaining"] = () =>
  controller().abortRemaining()
export const installDrainSignalHandlers: DrainController["installSignalHandlers"] =
  () => controller().installSignalHandlers()
