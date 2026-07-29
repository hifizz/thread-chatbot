## Why

当前客户端 Shiki 高亮只加载 10 个构建时写死的 grammar,任何未在集合内的语言(Go、Rust、Zig、Java、SQL……)在 `normalizeMarkdownLanguage` 阶段就被降级为 `text` 纯文本,永远无法高亮。直接把全部语言塞进 eager 集合又会让首屏 bundle 膨胀。需要一条既保首屏、又能覆盖长尾语言的路径。

## What Changes

- 将高频语言集合(EAGER)扩充到在 highlighter 初始化时同步加载,新增 **go / rust / zig**(shell 已由 `bash` 别名覆盖、plaintext 已由特殊语言 `text` 覆盖)。
- 新增**按需懒加载**能力:遇到 EAGER 之外但在受控注册表内的语言时,首次动态 `import` 该语言 grammar 并 `loadLanguage` 进单例 highlighter,随后**会话级复用缓存**,不再重复加载。
- 新增**并发去重**:同屏多个同语言代码块并发触发懒加载时只加载一次 grammar。
- 引入**显式 loader 注册表**(每语言一条 `import()` thunk),使打包器只为受控白名单语言切分 lazy chunk,避免模板字符串动态 import 导致全量 grammar 进入产物。
- 懒加载语言的加载失败沿用现有安全 fallback:降级为可读、可复制的 escaped plaintext,不阻断整条 Markdown 渲染。
- 扩充别名表(如 `golang`→`go`)并放行受控扩展语言,使其不在规范化阶段被打成 `text`。

## Capabilities

### New Capabilities
<!-- 无新增能力,懒加载并入既有语法高亮能力 -->

### Modified Capabilities
- `markdown-syntax-highlighting`: 受控语言集合从"单一构建时静态集合"演进为"EAGER 基础集合 + 受控扩展集合按需增量加载",并明确增量加载的会话级缓存与并发去重成本边界。

## Impact

- 代码:`constants/markdown-syntax-highlighting.ts`(EAGER/LAZY 集合拆分、别名扩充、loader 注册表)、`lib/markdown/syntax-highlighting.ts`(新增 `ensureLanguageLoaded` 与 highlighter 初始化 langs 调整)、`lib/markdown/syntax-language.ts`(规范化放行扩展语言)。
- 组件:`components/markdown/shiki-code.tsx` **无需改动**——其异步消费链(`isCurrent()`/`renderKey`/`stale`)已天然支持"先纯文本、grammar 到位后重渲染"。
- 依赖:复用已声明的 `@shikijs/langs`(4.3.1),新增语言只是新增该包已有子路径 import,无新依赖、无数据库/渲染管线变更。
- 验证:typecheck、生产构建成功,并记录 EAGER 首屏 bundle 与受控语言/loader 清单。
