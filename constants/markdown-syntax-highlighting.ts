/**
 * 浏览器端 Markdown 代码高亮的受控语言、别名和主题配置。
 * 保持集合显式，避免 Shiki 全量 grammar/theme 进入客户端 bundle。
 */
export const MARKDOWN_SHIKI_LANGUAGES = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "html",
  "css",
  "bash",
  "python",
  "markdown",
] as const;

export type MarkdownShikiLanguage =
  (typeof MARKDOWN_SHIKI_LANGUAGES)[number];

export const MARKDOWN_SHIKI_LANGUAGE_ALIASES = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  html: "html",
  htm: "html",
  js: "javascript",
  javascript: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  plain: "text",
  plaintext: "text",
  py: "python",
  python: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  text: "text",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  txt: "text",
  zsh: "bash",
} as const satisfies Record<string, MarkdownShikiLanguage | "text">;

export type NormalizedMarkdownShikiLanguage =
  | MarkdownShikiLanguage
  | "text";

export const MARKDOWN_SHIKI_THEMES = {
  light: "vitesse-light",
  dark: "vitesse-dark",
} as const;

export type MarkdownShikiThemeMode = keyof typeof MARKDOWN_SHIKI_THEMES;
