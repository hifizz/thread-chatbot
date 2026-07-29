/**
 * 浏览器 Shiki 共享核心的纯函数/异步契约测试：
 *   node --experimental-strip-types e2e/thread-chat/syntax-highlighting.test.mjs
 */
import {
  highlightMarkdownCode,
  normalizeMarkdownLanguage,
} from "../../lib/markdown/syntax-highlighting.ts"
import { createRetryableSingleton } from "../../lib/markdown/retryable-singleton.ts"

let failed = 0
const ok = (label, condition) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`)
  if (!condition) failed = 1
}

for (const [alias, expected] of [
  ["js", "javascript"],
  ["ts", "typescript"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["zsh", "bash"],
  ["md", "markdown"],
  ["txt", "text"],
]) {
  ok(
    `语言别名：${alias} → ${expected}`,
    normalizeMarkdownLanguage(alias).language === expected
  )
}

const unknown = normalizeMarkdownLanguage("future-lang")
ok("未知语言降级到 text", unknown.language === "text")
ok("未知语言保留原始标签", unknown.displayLanguage === "future-lang")

const shellSession = normalizeMarkdownLanguage("shell-session")
ok("shell-session 不截断为 shell", shellSession.displayLanguage === "shell-session")
ok("shell-session 不误走 Bash grammar", shellSession.language === "text")

const unknownResult = await highlightMarkdownCode({
  code: "<script>alert(1)</script>",
  language: "future-lang",
  themeMode: "dark",
})
ok("未知语言返回 plaintext", unknownResult.status === "plaintext")
ok("plaintext 不生成 HAST", unknownResult.hast === null)
ok(
  "plaintext 保留完整原始代码",
  unknownResult.code === "<script>alert(1)</script>"
)

const shellSessionResult = await highlightMarkdownCode({
  code: "$ echo must-stay-plaintext",
  language: "shell-session",
  themeMode: "light",
})
ok("shell-session 高亮请求返回 plaintext", shellSessionResult.status === "plaintext")

const staleBeforeStart = await highlightMarkdownCode({
  code: "const stale = true",
  language: "ts",
  themeMode: "dark",
  isCurrent: () => false,
})
ok("已过期 revision 不启动/提交高亮", staleBeforeStart.status === "stale")

let current = true
const racingResultPromise = highlightMarkdownCode({
  code: "const revision: number = 1",
  language: "ts",
  themeMode: "dark",
  isCurrent: () => current,
})
current = false
const racingResult = await racingResultPromise
ok("初始化期间过期的 revision 被丢弃", racingResult.status === "stale")

const highlighted = await highlightMarkdownCode({
  code: "const value = 1",
  language: "js",
  meta: "{1}",
  themeMode: "light",
})
ok("受支持语言生成 HAST", highlighted.status === "highlighted")
ok("高亮结果不使用 raw HTML 节点", !JSON.stringify(highlighted.hast).includes('"type":"raw"'))
ok(
  "light 模式使用 Vitesse Light",
  JSON.stringify(highlighted.hast).includes("vitesse-light")
)
ok(
  "fence meta transformer 标记目标行",
  JSON.stringify(highlighted.hast).includes("highlighted")
)
ok("高亮结果仍保留复制用原始代码", highlighted.code === "const value = 1")

const darkHighlighted = await highlightMarkdownCode({
  code: "const dark = true",
  language: "ts",
  themeMode: "dark",
})
ok(
  "dark 模式使用 Vitesse Dark",
  JSON.stringify(darkHighlighted.hast).includes("vitesse-dark")
)

let attempts = 0
const getRetryable = createRetryableSingleton(async () => {
  attempts += 1
  if (attempts === 1) throw new Error("first initialization failed")
  return { ready: true }
})
const firstAttempt = await Promise.allSettled([getRetryable(), getRetryable()])
ok(
  "并发初始化失败只执行一次 factory",
  attempts === 1 && firstAttempt.every((result) => result.status === "rejected")
)
const retried = await getRetryable()
ok("初始化失败后可重试", attempts === 2 && retried.ready)
ok("成功结果被 singleton 复用", (await getRetryable()) === retried && attempts === 2)

process.exit(failed)
