import {
  transformerMetaHighlight,
  transformerNotationDiff,
  transformerNotationHighlight,
} from "@shikijs/transformers";
import {
  createHighlighterCore,
  type HighlighterCore,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import {
  MARKDOWN_SHIKI_THEMES,
  type MarkdownShikiThemeMode,
  type NormalizedMarkdownShikiLanguage,
} from "../../constants/markdown-syntax-highlighting.ts";
import { createRetryableSingleton } from "./retryable-singleton.ts";
export { normalizeMarkdownLanguage } from "./syntax-language.ts";
import { normalizeMarkdownLanguage } from "./syntax-language.ts";

export const MARKDOWN_SHIKI_TRANSFORMERS = [
  transformerMetaHighlight(),
  transformerNotationDiff(),
  transformerNotationHighlight(),
];

export type MarkdownHighlightStatus =
  | "highlighted"
  | "plaintext"
  | "stale";

export interface MarkdownHighlightRequest {
  code: string;
  language?: string;
  meta?: string;
  themeMode: MarkdownShikiThemeMode;
  /**
   * 异步完成时用于判断调用方的 source revision 是否仍然有效。
   * 未提供时结果始终视为当前版本。
   */
  isCurrent?: () => boolean;
}

export interface MarkdownHighlightResult {
  code: string;
  displayLanguage: string;
  language: NormalizedMarkdownShikiLanguage;
  status: MarkdownHighlightStatus;
  hast: Awaited<ReturnType<HighlighterCore["codeToHast"]>> | null;
  error?: unknown;
}

/**
 * 复用一个细粒度浏览器 highlighter。并发初始化共享同一个 Promise；
 * 初始化失败后清空 in-flight 状态，使后续挂载可以重试。
 */
export const getMarkdownHighlighter = createRetryableSingleton(() =>
  createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
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
    ],
    themes: [
      import("@shikijs/themes/vitesse-light"),
      import("@shikijs/themes/vitesse-dark"),
    ],
  }),
);

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
  const normalized = normalizeMarkdownLanguage(language);
  const staleResult = (): MarkdownHighlightResult => ({
    ...normalized,
    code,
    status: "stale",
    hast: null,
  });
  const plaintextResult = (error?: unknown): MarkdownHighlightResult => ({
    ...normalized,
    code,
    status: "plaintext",
    hast: null,
    ...(error === undefined ? {} : { error }),
  });

  if (isCurrent && !isCurrent()) return staleResult();
  if (normalized.language === "text") return plaintextResult();

  try {
    const instance = await getMarkdownHighlighter();
    if (isCurrent && !isCurrent()) return staleResult();

    const hast = instance.codeToHast(code, {
      lang: normalized.language,
      theme: MARKDOWN_SHIKI_THEMES[themeMode],
      meta: meta ? { __raw: meta } : undefined,
      transformers: MARKDOWN_SHIKI_TRANSFORMERS,
    });

    if (isCurrent && !isCurrent()) return staleResult();

    return {
      ...normalized,
      code,
      status: "highlighted",
      hast,
    };
  } catch (error: unknown) {
    if (isCurrent && !isCurrent()) return staleResult();
    return plaintextResult(error);
  }
}
