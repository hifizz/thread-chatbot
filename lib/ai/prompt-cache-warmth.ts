export type PromptCacheWarmth =
  | "cold-start"
  | "partial-warm"
  | "warm-candidate"
  | "route-drift"
  | "ttl-expired"

interface PrefixSubmission {
  routeId: string
  submittedAt: number
}

export class PromptCacheWarmthTracker {
  private readonly byPrefix = new Map<string, PrefixSubmission[]>()

  constructor(private readonly maxPrefixes = 2_000) {}

  classify(input: {
    stablePrefixHash: string
    routeId: string
    nowMs: number
    ttlMs: number
    partialWarmHint?: boolean
  }): PromptCacheWarmth {
    const submissions = this.byPrefix.get(input.stablePrefixHash) ?? []
    const sameRoute = [...submissions]
      .reverse()
      .find((submission) => submission.routeId === input.routeId)
    if (sameRoute) {
      return input.nowMs - sameRoute.submittedAt <= input.ttlMs
        ? "warm-candidate"
        : "ttl-expired"
    }
    if (submissions.some((submission) => submission.routeId !== input.routeId)) {
      return "route-drift"
    }
    return input.partialWarmHint ? "partial-warm" : "cold-start"
  }

  markSubmitted(input: {
    stablePrefixHash: string
    routeId: string
    submittedAt: number
  }): void {
    const submissions = this.byPrefix.get(input.stablePrefixHash) ?? []
    const withoutRoute = submissions.filter(
      (submission) => submission.routeId !== input.routeId
    )
    this.byPrefix.set(input.stablePrefixHash, [
      ...withoutRoute,
      { routeId: input.routeId, submittedAt: input.submittedAt },
    ])
    while (this.byPrefix.size > this.maxPrefixes) {
      const oldest = this.byPrefix.keys().next().value as string | undefined
      if (!oldest) break
      this.byPrefix.delete(oldest)
    }
  }

  clear(): void {
    this.byPrefix.clear()
  }
}

const GLOBAL_TRACKER_SYMBOL = Symbol.for("thread-chat.prompt-cache-warmth")

type GlobalWithTracker = typeof globalThis & {
  [GLOBAL_TRACKER_SYMBOL]?: PromptCacheWarmthTracker
}

export function globalPromptCacheWarmthTracker(): PromptCacheWarmthTracker {
  const globalState = globalThis as GlobalWithTracker
  globalState[GLOBAL_TRACKER_SYMBOL] ??= new PromptCacheWarmthTracker()
  return globalState[GLOBAL_TRACKER_SYMBOL]
}
