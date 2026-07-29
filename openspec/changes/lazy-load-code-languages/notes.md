# 验证记录

## 受控语言清单

**EAGER(13,highlighter 初始化时同步加载)**
`javascript, typescript, jsx, tsx, json, html, css, bash, python, markdown, go, rust, zig`
> 本次新增:`go / rust / zig`。`shell` 由 `bash` 别名覆盖、`plaintext` 由特殊语言 `text` 覆盖,均已 eager。

**LAZY(11,首次遇到时经 `LANGUAGE_LOADERS` 按需加载,各自独立 chunk)**
`java, c, cpp, csharp, sql, yaml, toml, ruby, php, kotlin, swift`

**别名放行**:`golang→go`、`rs→rust`、`c++→cpp`、`c#/cs→csharp`、`yml→yaml`、`rb→ruby`、`kt→kotlin` 等,连同既有 `js/ts/sh/shell/zsh/md` 一并规范化。未在受控集合内的语言仍归一为 `text` 并保留原始 displayLanguage。

## Bundle 前后对比(grammar 原始体积,未 gzip)

> 说明:Shiki 高亮核心(含 EAGER grammar)本身已是 code-split,仅在**首个稳定代码块**出现时才动态加载,不进入初始页面 JS 首屏。以下为该按需 shiki chunk 的体积变化。

| 项 | 前 | 后 | 增量 |
|---|---|---|---|
| EAGER grammar 合计 | 985 KB(10) | 1058 KB(13) | **+72 KB**(go/rust/zig) |
| LAZY grammar | 0(不进 shiki 初始 chunk) | 各自独立懒加载 chunk,合计 934 KB | 仅在对应语言首次出现时才逐个拉取 |

各 LAZY 语言单文件:cpp 418KB、php 117KB、csharp 97KB、swift 91KB、c 76KB、ruby 50KB、java 29KB、sql 23KB、yaml 11KB、kotlin 9KB、toml 7KB。

## 打包切分验证(`pnpm build`)

- 生产构建 `✓ Compiled successfully`(与本变更无关的 `BETTER_AUTH_SECRET` 预渲染告警同基线,不影响构建)。
- 以 `scopeName":"source.X"`(真 grammar 唯一声明,区别于 markdown grammar 中的 `include` 引用)统计客户端 chunk:
  - 受控 LAZY 语言均有真 grammar chunk(csharp 的 scopeName 为 `source.cs`)。
  - 未受控语言(haskell/elixir/erlang/dart/scala/clojure/perl)均为 0 —— **未全量打包 ~200 语言**。
  - 唯一例外 `lua` 系 `ruby` 的 `embeddedLangs` 传递依赖(Ruby heredoc 内嵌),属受控集合的有界传递闭包,非独立用户语言。

## 功能验证(无头,直连真实 `highlightMarkdownCode` 模块)

9/9 通过:
- EAGER `go/rust/zig`:首屏即 `highlighted`(`loadedBefore=true`)。
- LAZY `java/sql`:调用前 `getLoadedLanguages` 不含 → 调用后含 → `highlighted`。
- 缓存复用 `java`:二次请求命中已加载 grammar,不重复加载。
- 并发去重 `kotlin`:3 并发只加载一次。
- 未知语言 `cobol`:降级 `plaintext`,`language=text`,保留 `displayLanguage=cobol`,不抛异常。
- 别名 `golang → go`。

## typecheck

`pnpm typecheck` 通过,`LANGUAGE_LOADERS` 的 `satisfies Record<MarkdownShikiLazyLanguage, …>` 约束保证注册表 key 与 LAZY 集合无漂移。
