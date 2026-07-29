import type { LanguageInput } from "@shikijs/types"

/**
 * 浏览器端 Markdown 代码高亮的受控语言、别名、加载器和主题配置。
 * 保持集合显式,避免 Shiki 全量 grammar/theme 进入客户端 bundle。
 *
 * 受控语言分两层:
 * - EAGER:高频语言,在 highlighter 初始化时同步加载,保证首屏即高亮。
 * - LAZY:受控扩展集合,首次遇到时经 `LANGUAGE_LOADERS` 按需动态加载,
 *   加载后由单例 highlighter 会话级复用(见 lib/markdown/syntax-highlighting.ts)。
 */
export const MARKDOWN_SHIKI_EAGER_LANGUAGES = [
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
  "go",
  "rust",
  "zig",
] as const

export const MARKDOWN_SHIKI_LAZY_LANGUAGES = [
  "java",
  "c",
  "cpp",
  "csharp",
  "sql",
  "yaml",
  "toml",
  "ruby",
  "php",
  "kotlin",
  "swift",
] as const

export const MARKDOWN_SHIKI_LANGUAGES = [
  ...MARKDOWN_SHIKI_EAGER_LANGUAGES,
  ...MARKDOWN_SHIKI_LAZY_LANGUAGES,
] as const

export type MarkdownShikiEagerLanguage =
  (typeof MARKDOWN_SHIKI_EAGER_LANGUAGES)[number]

export type MarkdownShikiLazyLanguage =
  (typeof MARKDOWN_SHIKI_LAZY_LANGUAGES)[number]

export type MarkdownShikiLanguage =
  MarkdownShikiEagerLanguage | MarkdownShikiLazyLanguage

/**
 * 显式的懒加载 grammar 注册表:每个受控扩展语言一条 `import()` thunk。
 * 用 `satisfies` 约束 key 与 LAZY 集合同源(漏配即 typecheck 报错),
 * 并保证打包器只为白名单语言切分 lazy chunk,而非全量 grammar。
 */
export const LANGUAGE_LOADERS = {
  java: () => import("@shikijs/langs/java"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  sql: () => import("@shikijs/langs/sql"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  swift: () => import("@shikijs/langs/swift"),
} as const satisfies Record<MarkdownShikiLazyLanguage, () => LanguageInput>

export const MARKDOWN_SHIKI_LANGUAGE_ALIASES = {
  bash: "bash",
  c: "c",
  "c++": "cpp",
  "c#": "csharp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  csharp: "csharp",
  css: "css",
  go: "go",
  golang: "go",
  html: "html",
  htm: "html",
  java: "java",
  js: "javascript",
  javascript: "javascript",
  json: "json",
  jsx: "jsx",
  kotlin: "kotlin",
  kt: "kotlin",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  plain: "text",
  plaintext: "text",
  py: "python",
  python: "python",
  rb: "ruby",
  rs: "rust",
  ruby: "ruby",
  rust: "rust",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  sql: "sql",
  swift: "swift",
  text: "text",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  txt: "text",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
  zsh: "bash",
} as const satisfies Record<string, MarkdownShikiLanguage | "text">

export type NormalizedMarkdownShikiLanguage = MarkdownShikiLanguage | "text"

export const MARKDOWN_SHIKI_THEMES = {
  light: "vitesse-light",
  dark: "vitesse-dark",
} as const

export type MarkdownShikiThemeMode = keyof typeof MARKDOWN_SHIKI_THEMES
