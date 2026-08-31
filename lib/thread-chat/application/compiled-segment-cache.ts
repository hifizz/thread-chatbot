import { createHmac } from "node:crypto"
import type { PromptSegmentKind } from "@/lib/thread-chat/application/prompt-cache"

export type CompiledSegmentCacheKeyInput = {
  tenantSalt: string
  userId: string
  projectId: string
  promptCompilerVersion: string
  segmentKind: PromptSegmentKind
  sourceContentHash: string
  modelFamily: string
  attachmentStrategyVersion: string
  toolProfileId?: string
}

export type CompiledSegmentCacheKey = string & {
  readonly __compiledSegmentCacheKey: unique symbol
}

export type CompiledPromptSegment = {
  kind: PromptSegmentKind
  contentHash: string
  modelMessages: unknown[]
  characters: number
  createdAt: string
}

export interface CompiledSegmentCache {
  get(key: CompiledSegmentCacheKey): Promise<CompiledPromptSegment | null>
  set(
    key: CompiledSegmentCacheKey,
    value: CompiledPromptSegment,
    ttlMs: number
  ): Promise<void>
  delete(key: CompiledSegmentCacheKey): Promise<void>
  clear(): Promise<void>
}

export function compiledSegmentCacheKey(
  input: CompiledSegmentCacheKeyInput
): CompiledSegmentCacheKey {
  const tenant = createHmac("sha256", input.tenantSalt)
    .update(`${input.userId}\u001f${input.projectId}`, "utf8")
    .digest("hex")
  const material = [
    tenant,
    input.promptCompilerVersion,
    input.segmentKind,
    input.sourceContentHash,
    input.modelFamily,
    input.attachmentStrategyVersion,
    input.toolProfileId ?? "none",
  ].join("\u001f")
  return createHmac("sha256", input.tenantSalt)
    .update(material, "utf8")
    .digest("hex") as CompiledSegmentCacheKey
}

export class NoopCompiledSegmentCache implements CompiledSegmentCache {
  async get(): Promise<null> {
    return null
  }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
  async clear(): Promise<void> {}
}

type LruEntry = {
  value: CompiledPromptSegment
  expiresAt: number
}

/**
 * Bounded in-process implementation for measurement only. Distributed caches
 * are deliberately absent until cross-instance benefit and data controls are proven.
 */
export class InMemoryCompiledSegmentCache implements CompiledSegmentCache {
  private readonly values = new Map<CompiledSegmentCacheKey, LruEntry>()

  constructor(private readonly maximumEntries = 100) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
      throw new Error("INVALID_COMPILED_SEGMENT_CACHE_CAPACITY")
    }
  }

  async get(key: CompiledSegmentCacheKey): Promise<CompiledPromptSegment | null> {
    const entry = this.values.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key)
      return null
    }
    this.values.delete(key)
    this.values.set(key, entry)
    return structuredClone(entry.value)
  }

  async set(
    key: CompiledSegmentCacheKey,
    value: CompiledPromptSegment,
    ttlMs: number
  ): Promise<void> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("INVALID_COMPILED_SEGMENT_CACHE_TTL")
    }
    this.values.delete(key)
    this.values.set(key, {
      value: structuredClone(value),
      expiresAt: Date.now() + ttlMs,
    })
    while (this.values.size > this.maximumEntries) {
      const oldest = this.values.keys().next().value as
        | CompiledSegmentCacheKey
        | undefined
      if (!oldest) break
      this.values.delete(oldest)
    }
  }

  async delete(key: CompiledSegmentCacheKey): Promise<void> {
    this.values.delete(key)
  }

  async clear(): Promise<void> {
    this.values.clear()
  }

  size(): number {
    return this.values.size
  }
}

export function resolveCompiledSegmentCache(
  mode: string | undefined = process.env.THREAD_PROMPT_COMPILED_SEGMENT_CACHE
): CompiledSegmentCache {
  return mode === "memory"
    ? new InMemoryCompiledSegmentCache()
    : new NoopCompiledSegmentCache()
}
