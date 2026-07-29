## 1. 常量层:集合拆分与 loader 注册表

- [x] 1.1 在 `constants/markdown-syntax-highlighting.ts` 拆分 `MARKDOWN_SHIKI_EAGER_LANGUAGES`(现有 10 个 + go、rust、zig)与受控扩展集合 `MARKDOWN_SHIKI_LAZY_LANGUAGES`(java、c、cpp、csharp、sql、yaml、toml、ruby、php、kotlin、swift、go... 取常用集合)
- [x] 1.2 将 `MarkdownShikiLanguage` 类型改为 EAGER ∪ LAZY 的联合类型,保持 `NormalizedMarkdownShikiLanguage` 含 `text`
- [x] 1.3 新增显式 `LANGUAGE_LOADERS: Record<扩展语言, () => Promise<LangImport>>`,每语言一条 `() => import("@shikijs/langs/<lang>")` thunk(用类型约束保证 key 与 LAZY 集合同源)
- [x] 1.4 扩充 `MARKDOWN_SHIKI_LANGUAGE_ALIASES`:补 `golang`→`go` 及新增语言的常用别名,确保受控扩展语言均可被规范化放行

## 2. 规范化层:放行扩展语言

- [x] 2.1 确认 `lib/markdown/syntax-language.ts` 的 `normalizeMarkdownLanguage` 以扩充后的别名/集合为准,受控扩展语言不再被降级为 `text`
- [x] 2.2 未在受控集合(EAGER ∪ LAZY)内的语言仍归一为 `text` 并保留原始 displayLanguage

## 3. 加载层:按需懒加载与去重

- [x] 3.1 在 `lib/markdown/syntax-highlighting.ts` 将 `createHighlighterCore` 的初始 `langs` 改为仅 EAGER 集合(含 go/rust/zig 的 grammar import)
- [x] 3.2 新增 `ensureLanguageLoaded(instance, lang)`:EAGER 或 `instance.getLoadedLanguages()` 已含则直接返回;否则 `await LANGUAGE_LOADERS[lang]()` → `await instance.loadLanguage(grammar)`
- [x] 3.3 用 `WeakMap<HighlighterCore, Map<lang, Promise>>` 对并发同语言加载去重,单例重建后随实例 GC 回收
- [x] 3.4 在 `highlightMarkdownCode` 中于 `getMarkdownHighlighter()` 之后、`codeToHast` 之前 `await ensureLanguageLoaded(...)`,并在两侧保留 `isCurrent()` 防竞态判断
- [x] 3.5 grammar 加载失败沿用现有 `catch → plaintextResult(error)` 降级,不阻断整条 Markdown 渲染

## 4. 验证与记录

- [x] 4.1 `pnpm typecheck` 通过,确认注册表 key 与受控语言联合类型无漂移
- [x] 4.2 手动/交互验证:Go/Rust/Zig 首屏即高亮;Java/SQL 等首次显示 plaintext 后异步高亮;同语言再次出现复用缓存;未知语言仍 plaintext
- [x] 4.3 `pnpm build` 生产构建成功,确认仅受控扩展语言生成 lazy chunk(无全量 grammar chunk)
- [x] 4.4 在变更记录中补充 EAGER 首屏语言清单、受控扩展语言/loader 注册表清单,以及首屏 bundle 前后对比
