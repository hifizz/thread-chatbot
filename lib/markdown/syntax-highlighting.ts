import {
  transformerMetaHighlight,
  transformerNotationDiff,
  transformerNotationHighlight,
} from "@shikijs/transformers"
import { createHighlighterCore, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

import {
  LANGUAGE_LOADERS,
  MARKDOWN_SHIKI_EAGER_LANGUAGES,
  MARKDOWN_SHIKI_THEMES,
  type MarkdownShikiLazyLanguage,
  type MarkdownShikiThemeMode,
  type NormalizedMarkdownShikiLanguage,
} from "../../constants/markdown-syntax-highlighting.ts"
import { createRetryableSingleton } from "./retryable-singleton.ts"
export { normalizeMarkdownLanguage } from "./syntax-language.ts"
import { normalizeMarkdownLanguage } from "./syntax-language.ts"

export const MARKDOWN_SHIKI_TRANSFORMERS = [
  transformerMetaHighlight(),
  transformerNotationDiff(),
  transformerNotationHighlight(),
]

export type MarkdownHighlightStatus = "highlighted" | "plaintext" | "stale"

export interface MarkdownHighlightRequest {
  code: string
  language?: string
  meta?: string
  themeMode: MarkdownShikiThemeMode
  /**
   * 异步完成时用于判断调用方的 source revision 是否仍然有效。
   * 未提供时结果始终视为当前版本。
   */
  isCurrent?: () => boolean
}

export interface MarkdownHighlightResult {
  code: string
  displayLanguage: string
  language: NormalizedMarkdownShikiLanguage
  status: MarkdownHighlightStatus
  hast: Awaited<ReturnType<HighlighterCore["codeToHast"]>> | null
  error?: unknown
}

/**
 * 复用一个细粒度浏览器 highlighter。并发初始化共享同一个 Promise；
 * 初始化失败后清空 in-flight 状态，使后续挂载可以重试。
 */
export const getMarkdownHighlighter = createRetryableSingleton(() =>
  createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    // 仅同步加载 EAGER 基础集合;LAZY 扩展语言经 ensureLanguageLoaded 按需加载。
    langs: [
      import("@shikijs/langs/javascript"),
      import("@shikijs/langs/typescript"),
      import("@shikijs/langs/jsx"),
      import("@shikijs/langs/tsx"),
      import("@shikijs/langs/json"),
      import("@shikijs/langs/html"),
      import("@shikijs/langs/css"),
      import("@shikijs/langs/bash"),
      import("@shikijs/langs/python"),
      import("@shikijs/langs/markdown"),
      import("@shikijs/langs/go"),
      import("@shikijs/langs/rust"),
      import("@shikijs/langs/zig"),
    ],
    themes: [
      import("@shikijs/themes/vitesse-light"),
      import("@shikijs/themes/vitesse-dark"),
    ],
  })
)

const EAGER_LANGUAGE_SET = new Set<string>(MARKDOWN_SHIKI_EAGER_LANGUAGES)

/**
 * 按 highlighter 实例分片的在途懒加载表,对并发的同语言加载去重。
 * 挂在实例上:单例失败重建后,旧实例连同其在途表一并被 GC 回收,
 * 新实例的 getLoadedLanguages() 自然归零,不残留指向旧实例的脏 promise。
 */
const inflightLanguageLoads = new WeakMap<
  HighlighterCore,
  Map<string, Promise<void>>
>()

/**
 * 确保受控扩展语言的 grammar 已注入给定 highlighter 实例。
 * EAGER 语言、text 或已加载语言直接返回;其余经 LANGUAGE_LOADERS 动态加载,
 * 会话级复用已加载 grammar,并对并发同语言加载去重。加载失败向上抛出,
 * 由 highlightMarkdownCode 的 catch 统一降级为 plaintext,且不缓存失败以便重试。
 */
async function ensureLanguageLoaded(
  instance: HighlighterCore,
  language: NormalizedMarkdownShikiLanguage
): Promise<void> {
  if (language === "text") return
  if (EAGER_LANGUAGE_SET.has(language)) return
  if (instance.getLoadedLanguages().includes(language)) return

  const loader = LANGUAGE_LOADERS[language as MarkdownShikiLazyLanguage]
  if (!loader) return

  let inflight = inflightLanguageLoads.get(instance)
  if (!inflight) {
    inflight = new Map()
    inflightLanguageLoads.set(instance, inflight)
  }

  let pending = inflight.get(language)
  if (!pending) {
    pending = (async () => {
      await instance.loadLanguage(await loader())
    })().catch((error: unknown) => {
      inflight.delete(language)
      throw error
    })
    inflight.set(language, pending)
  }

  await pending
}

/**
 * 返回安全 HAST，不生成或注入 raw HTML。未知语言和加载失败均返回
 * plaintext 结果，由 renderer 使用原始 code 字符串展示与复制。
 */
export async function highlightMarkdownCode({
  code,
  language,
  meta,
  themeMode,
  isCurrent,
}: MarkdownHighlightRequest): Promise<MarkdownHighlightResult> {
  const normalized = normalizeMarkdownLanguage(language)
  const staleResult = (): MarkdownHighlightResult => ({
    ...normalized,
    code,
    status: "stale",
    hast: null,
  })
  const plaintextResult = (error?: unknown): MarkdownHighlightResult => ({
    ...normalized,
    code,
    status: "plaintext",
    hast: null,
    ...(error === undefined ? {} : { error }),
  })

  if (isCurrent && !isCurrent()) return staleResult()
  if (normalized.language === "text") return plaintextResult()

  try {
    const instance = await getMarkdownHighlighter()
    if (isCurrent && !isCurrent()) return staleResult()

    await ensureLanguageLoaded(instance, normalized.language)
    if (isCurrent && !isCurrent()) return staleResult()

    const hast = instance.codeToHast(code, {
      lang: normalized.language,
      theme: MARKDOWN_SHIKI_THEMES[themeMode],
      meta: meta ? { __raw: meta } : undefined,
      transformers: MARKDOWN_SHIKI_TRANSFORMERS,
    })

    if (isCurrent && !isCurrent()) return staleResult()

    return {
      ...normalized,
      code,
      status: "highlighted",
      hast,
    }
  } catch (error: unknown) {
    if (isCurrent && !isCurrent()) return staleResult()
    return plaintextResult(error)
  }
}
