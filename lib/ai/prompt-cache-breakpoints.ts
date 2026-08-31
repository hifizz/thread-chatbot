import type {
  PromptCacheBoundaryKind,
  PromptManifest,
} from "@/lib/thread-chat/application/prompt-compiler"

export interface SelectedCacheBreakpoint {
  kind: PromptCacheBoundaryKind
  characterOffset: number
  tokenEstimate: number
}

/**
 * 优先保护兄弟分支，其次同一分支续聊，最后才是 Kernel。
 * 选择只依赖 Manifest 和 Route capability，结果可重复。
 */
export function selectCacheBreakpoints(input: {
  manifest: PromptManifest
  minimumPrefixTokens: number
  maxBreakpoints: number
}): SelectedCacheBreakpoint[] {
  if (input.maxBreakpoints <= 0) return []
  const byKind = new Map(
    input.manifest.candidateBoundaries.map((boundary) => [
      boundary.kind,
      boundary,
    ])
  )
  const preference: PromptCacheBoundaryKind[] = [
    "inherited-end",
    "branch-history-end",
    "kernel-end",
  ]
  const selected: SelectedCacheBreakpoint[] = []
  const offsets = new Set<number>()
  for (const kind of preference) {
    const boundary = byKind.get(kind)
    if (
      !boundary ||
      boundary.tokenEstimate < input.minimumPrefixTokens ||
      offsets.has(boundary.characterOffset)
    ) {
      continue
    }
    selected.push(boundary)
    offsets.add(boundary.characterOffset)
    if (selected.length >= input.maxBreakpoints) break
  }
  return selected
}
