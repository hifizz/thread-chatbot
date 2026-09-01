import { createHash, createHmac } from "node:crypto"
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

/** Compatibility shape retained for early fixtures and local measurement tools. */
export type LegacyCompiledSegmentCacheKeyInput = {
  tenantHmac: string
  compilerVersion: string
  segmentKind: PromptSegmentKind
  sourceHash: string
  modelFamily: string
  attachmentStrategyVersion?: string
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
  input: CompiledSegmentCacheKeyInput | LegacyCompiledSegmentCacheKeyInput
): CompiledSegmentCacheKey {
  if ("tenantHmac" in input) {
    const material = [
      input.tenantHmac,
      input.compilerVersion,
      input.segmentKind,
      input.sourceHash,
      input.modelFamily,
      input.attachmentStrategyVersion ?? "default",
      input.toolProfileId ?? "none",
    ].join("\u001f")
    return createHash("sha256")
      .update(material, "utf8")
      .digest("hex") as CompiledSegmentCacheKey
  }

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

type CacheGetInput = CompiledSegmentCacheKey | { key: CompiledSegmentCacheKey }
type CacheSetInput = {
  key: CompiledSegmentCacheKey
  value: CompiledPromptSegment
  ttlMs: number
}

function cacheKey(input: CacheGetInput): CompiledSegmentCacheKey {
  return typeof input === "string" ? input : input.key
}

export class NoopCompiledSegmentCache implements CompiledSegmentCache {
  async get(_key: CacheGetInput): Promise<null> {
    return null
  }
  async set(
    _keyOrInput: CompiledSegmentCacheKey | CacheSetInput,
    _value?: CompiledPromptSegment,
    _ttlMs?: number
  ): Promise<void> {}
  async delete(_key: CompiledSegmentCacheKey): Promise<void> {}
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
  private readonly maximumEntries: number

  constructor(options: number | { maxEntries: number } = 100) {
    this.maximumEntries =
      typeof options === "number" ? options : options.maxEntries
    if (!Number.isInteger(this.maximumEntries) || this.maximumEntries < 1) {
      throw new Error("INVALID_COMPILED_SEGMENT_CACHE_CAPACITY")
    }
  }

  async get(input: CacheGetInput): Promise<CompiledPromptSegment | null> {
    const key = cacheKey(input)
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
    keyOrInput: CompiledSegmentCacheKey | CacheSetInput,
    value?: CompiledPromptSegment,
    ttlMs?: number
  ): Promise<void> {
    const input =
      typeof keyOrInput === "string"
        ? { key: keyOrInput, value, ttlMs }
        : keyOrInput
    if (!input.value) throw new Error("INVALID_COMPILED_SEGMENT_CACHE_VALUE")
    if (!Number.isFinite(input.ttlMs) || (input.ttlMs ?? 0) <= 0) {
      throw new Error("INVALID_COMPILED_SEGMENT_CACHE_TTL")
    }
    this.values.delete(input.key)
    this.values.set(input.key, {
      value: structuredClone(input.value),
      expiresAt: Date.now() + input.ttlMs!,
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
