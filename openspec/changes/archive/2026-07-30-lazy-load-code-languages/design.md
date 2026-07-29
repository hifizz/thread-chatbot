## Context

客户端 Shiki 高亮由 `add-client-shiki-highlighting` 引入,`createHighlighterCore` 在初始化时一次性加载 10 个构建时写死的 grammar(`lib/markdown/syntax-highlighting.ts`),语言集合与别名收敛在 `constants/markdown-syntax-highlighting.ts`。渲染入口 `components/markdown/shiki-code.tsx` 先经 `normalizeMarkdownLanguage` 归一,再异步调用 `highlightMarkdownCode`,已有 `isCurrent()` / `renderKey` / `stale` 三重防竞态。

现状两道关卡使新语言无法高亮:(1) 归一化关卡——不在别名表的语言被打成 `text`,组件早退,异步链根本不触发;(2) grammar 关卡——初始化 langs 数组静态写死,新语言 grammar 从不进入实例。把全部 ~200 语言塞进 eager 又会撑大首屏 bundle。

Shiki core 原生支持增量加载:`HighlighterCore.loadLanguage(grammar)` 与 `getLoadedLanguages()`(`@shikijs/types` 4.3.1 已验证)。`@shikijs/langs` 已声明为直接依赖,每个语言是其已有子路径。

## Goals / Non-Goals

**Goals:**
- 扩充 EAGER 基础集合,新增 go / rust / zig(shell 已由 `bash` 别名覆盖、plaintext 由 `text` 覆盖)。
- 遇到受控扩展语言时按需加载 grammar,会话级复用,并发去重。
- 打包器只为受控白名单语言切 lazy chunk,不产生全量 grammar chunk。
- 组件层零改动——复用既有异步消费与防竞态链路。

**Non-Goals:**
- 不做主题懒加载(仅 2 个主题、体积小,收益低)。
- 不支持注册表之外的任意语言(未知语言仍降级 plaintext)。
- 不改数据库、渲染管线、复制/安全边界。
- 不引入按代码内容 key 的永久结果缓存。

## Decisions

### 决策 1:EAGER / LAZY 双集合 + 显式 loader 注册表

在 `constants/markdown-syntax-highlighting.ts` 拆出两个集合:`EAGER`(初始化同步加载)与受控扩展集合;扩展语言经一张**显式 thunk 注册表** `LANGUAGE_LOADERS: Record<lang, () => Promise<LangImport>>` 提供动态 import。

- **为何显式 thunk 而非 `import(\`@shikijs/langs/${lang}\`)`**:模板字符串会让 Turbopack 为全部 grammar 生成 lazy chunk,污染产物、拖慢构建。显式注册表让打包器只为白名单语言切 chunk。
- **替代方案**:全量 eager(否决——首屏膨胀);运行时 fetch 远程 grammar(否决——引入网络与 CSP 复杂度,`@shikijs/langs` 本地已有)。

### 决策 2:`ensureLanguageLoaded(instance, lang)`,以 `getLoadedLanguages()` 为缓存真相

在 `lib/markdown/syntax-highlighting.ts` 新增该函数,`highlightMarkdownCode` 于 `getMarkdownHighlighter()` 之后、`codeToHast` 之前 `await` 它。逻辑:EAGER 或 `getLoadedLanguages()` 已含 → 直接返回;否则 `await LANGUAGE_LOADERS[lang]()` → `await instance.loadLanguage(grammar)`。

- **缓存**:语言一旦 `loadLanguage` 进单例,`getLoadedLanguages()` 永久反映——这就是会话级缓存,无需自建缓存表,契合"浏览器成本有界"需求。
- **失败降级**:load 失败落入现有 `catch → plaintextResult`。

### 决策 3:并发去重用 `WeakMap<HighlighterCore, Map<lang, Promise>>`

按语言分片的在途 promise 表,挂在实例上。同屏多个同语言块只加载一次;单例失败重建后,旧实例连同其在途表被 GC 回收,新实例 `getLoadedLanguages()` 自然归零,不残留脏 promise。思路与既有 `createRetryableSingleton` 一致,只是按语言分片。

- **替代方案**:模块级全局 `Map`(否决——单例重建后可能残留指向旧实例的在途 promise)。

### 决策 4:规范化放行扩展语言 + 别名扩充

`normalizeMarkdownLanguage` 的合法集合并入受控扩展集合,别名表补 `golang`→`go` 等,否则扩展语言在第一关就被打成 `text`,懒加载永不触发。

## Risks / Trade-offs

- **[grammar 依赖链导致 chunk 变大]** 某些语言 grammar 内嵌其它 grammar(如 `tsx` 依赖 `typescript`)→ 注册表按语言各自 import,Shiki 会解析嵌入依赖;若嵌入语言未加载,Shiki 通常自带回退,必要时在注册表对应 thunk 中一并 import 依赖 grammar。
- **[懒加载首次有可见延迟]** 首个扩展语言代码块从 plaintext 闪到高亮 → 已被"流式先 plaintext"契约覆盖,视觉上与流式结束后的高亮一致,可接受。
- **[注册表与别名表漂移]** 扩展语言加进注册表却漏加别名/放行 → 归一化早退成 text → 用类型约束让注册表 key 与受控语言联合类型同源,typecheck 兜底。
- **[EAGER 扩容增大首屏]** 新增 go/rust/zig 三个 grammar 进 eager → 三者为高频语言,权衡后接受;其余长尾一律走 lazy。

## Migration Plan

纯增量、向后兼容,无数据迁移。上线后既有 10 语言行为不变,新增语言即时生效。回滚 = 还原三个源文件即可,无 schema/持久层副作用。
