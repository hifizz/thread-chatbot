import {
  MARKDOWN_SHIKI_LANGUAGE_ALIASES,
  type NormalizedMarkdownShikiLanguage,
} from "../../constants/markdown-syntax-highlighting.ts";

/**
 * 规范化 Markdown fence 的语言标签。未知语言保留为 displayLanguage，
 * tokenization 则安全降级到 Shiki 的特殊 `text` 语言。
 */
export function normalizeMarkdownLanguage(language?: string): {
  displayLanguage: string;
  language: NormalizedMarkdownShikiLanguage;
} {
  const displayLanguage = language?.trim().toLowerCase() ?? "";
  const normalized =
    MARKDOWN_SHIKI_LANGUAGE_ALIASES[
      displayLanguage as keyof typeof MARKDOWN_SHIKI_LANGUAGE_ALIASES
    ];

  return {
    displayLanguage,
    language: normalized ?? "text",
  };
}
