## Context

仓库当前存在两条 Markdown 渲染链路：

- Thread Chat 使用 `app/thread-chat/chat/markdown-body.tsx` 组合 `react-markdown` 与 `remark-gfm`，并由列视图、Canvas 展开视图和 Artifact drawer 共同复用。其 fenced code block 已通过共享组件使用 token 级高亮。
- assistant-ui 使用 `components/assistant-ui/markdown-text.tsx`，其 Shiki streaming adapter 已注册到 Markdown renderer。

Thread Chat 的持久文本锚点依赖 `AnchoredMarkdown` 在 `.md-body` 内定位并标记文本 DOM。Shiki 会在浏览器中异步生成 token DOM；若高亮完成后不通知锚点系统重新定位，恢复的锚点高亮、脚注和点击命中可能被后续 React commit 覆盖。Canvas 分支连线只依赖树拓扑，不读取 Markdown DOM 几何，因此不属于本次 settled 契约。

实现直接使用 `shiki@4.3.1` 和 `@shikijs/transformers@4.3.1`；`react-shiki`、`react-syntax-highlighter` 及 Prism 路线均已移除。目标是使用 Shiki 当前的浏览器能力，不引入服务端高亮接口，也不迁移现有 Markdown renderer。

## Goals / Non-Goals

**Goals**

- 为两条 Markdown renderer 的 fenced code block 提供一致、可复用的 Shiki 语法高亮。
- 流式消息保持低抖动：生成期间渲染 plaintext，内容稳定后异步切换为 token DOM。
- 以明确的语言、主题和 engine 集合控制浏览器 bundle，并为未知语言或加载失败提供可靠降级。
- 保留现有语言标签、复制按钮、代码原文和安全边界。
- 让 Thread Chat 在异步代码 DOM 稳定后重新解析并重绘持久文本锚点与脚注。
- 让静态 Markdown Artifact、列视图和 Canvas 复用同一能力，而不是维护独立高亮实现。

**Non-Goals**

- 不迁移到 Streamdown 或替换 `react-markdown`。
- 不支持 raw HTML、Mermaid、KaTeX、Twoslash、代码执行或服务端高亮。
- 不尝试复刻 Codex、ChatGPT、Kimi 或 Claude 的私有 Web 实现。
- 不为任意语言打包完整 Shiki 语言集合，也不按完整代码内容建立无界全局缓存。
- 不改变 Markdown Artifact 数据结构、聊天协议、数据库或 API。

## Decisions

### 1. 共享高亮核心，各 renderer 保留自己的 adapter

建立一个不依赖 assistant-ui runtime 的客户端高亮核心，集中维护：

- singleton highlighter 的初始化与复用；
- JavaScript RegExp engine；
- 支持语言、别名和 plaintext fallback；
- 主题组合及 transformers；
- 加载失败的可恢复状态。

Thread Chat 与 assistant-ui 各自保留轻量 adapter，把自身的 Markdown node、流式状态、代码框 UI 和 settled callback 转换为共享核心输入。

这样可以复用最昂贵且最容易漂移的配置，同时避免让 Thread Chat 依赖 assistant-ui 的上下文。直接把 Thread Chat renderer 改造成 assistant-ui renderer 会扩大变更面，并破坏当前 Artifact/Canvas 复用途径，因此不采用。

### 2. 在 fenced code component 层高亮，不增加 rehype HTML 注入阶段

高亮发生在 Markdown renderer 的 fenced code component 中。inline code 继续使用现有轻量样式，不初始化 Shiki。

组件接收原始代码、规范化语言和 fence meta；共享核心返回 React 可渲染的 token 结构或等价的安全 HAST 转换结果。不得通过不受控的 raw HTML 打开 Markdown HTML 执行能力。

相比在 rehype 阶段整体转换 Markdown，这一方式能直接访问 streaming 状态、复制按钮和锚点 settled callback，也无需改写当前 Markdown pipeline。

### 3. 流式阶段 plaintext，稳定后按代码版本异步高亮

消息仍在流式生成时：

- fenced code 立即显示完整的纯文本代码框；
- 不为每个 token 增量重复调用 Shiki；
- 复制操作始终读取原始代码字符串。

消息变为稳定状态后，组件为当前的 `code + language + meta + theme` 版本发起一次异步高亮。若高亮尚未完成时输入版本变化，旧结果不得覆盖新版本。静态内容（包括 Artifact）可以直接进入异步高亮。

不建立跨消息、按完整代码字符串索引的全局结果缓存；只复用 highlighter、已加载 grammar 和 theme。组件级结果随对应内容生命周期释放。

### 4. 使用细粒度浏览器配置和受控语言集合

highlighter 使用 Shiki 的 JavaScript RegExp engine，避免把 Oniguruma WASM 作为本需求的默认成本。只注册产品常见的初始语言集合：

- plaintext/text/txt；
- JavaScript、TypeScript、JSX、TSX；
- JSON；
- HTML；
- CSS；
- Bash/Shell；
- Python；
- Markdown。

语言别名在共享配置中规范化，例如 `js → javascript`、`ts → typescript`、`sh/shell/zsh → bash`、`md → markdown`、`html → html`。语言为空或不受支持时使用 plaintext grammar，同时保留原始语言标签供用户识别。

若后续真实 Markdown 样本需要扩展语言，必须显式加入受控集合并重新检查 bundle，而不是启用全量导入。

### 5. 使用同一主题家族，允许表面选择对应分支

共享配置提供同一主题家族的 light/dark 配对。assistant-ui 根据当前主题选择分支；Thread Chat 当前只有 paper 风格浅色页面，因此代码框固定选择 light 分支并使用浅色 chrome。等 Thread Chat 整体完成 dark mode 后，代码框再随页面主题切换，不能提前形成页面浅色、代码框深色的割裂状态。token 颜色由对应 Shiki theme 输出承接，代码框布局、圆角、标签与按钮仍由现有表面样式控制。

参考 `prose-atelier` 的体验，fence meta 支持常用 notation/高亮标记 transformers。无法识别的 meta 必须被忽略，不能阻断代码显示。transformer 只增加展示标记，不改变复制文本。

### 6. MarkdownBody 暴露内容稳定通知，锚点层消费该通知

Thread Chat 的共享 Markdown renderer 提供内容稳定通知。对于当前 Markdown source：

- 没有待处理代码块时，正文渲染完成即可视为稳定；
- 有代码块时，所有当前版本的代码块完成高亮或降级后才发出稳定通知；
- 过期 source 的异步完成不得触发当前版本通知。

`AnchoredMarkdown` 将该稳定 revision 纳入锚点绘制依赖。在通知后重新查询 `.md-body`，恢复持久锚点高亮、脚注和点击标记，而不是依赖固定延时。避免全局 `MutationObserver`，因为其范围更宽、难以区分本次高亮与其它 UI 变更。

### 7. 失败以局部 plaintext 降级，不阻断整段 Markdown

highlighter 初始化、grammar 加载或单块转换失败时，仅该代码块回退到 escaped plaintext，并保持语言标签和复制按钮。失败状态应可观测但不得导致 Error Boundary 接管整条消息。

singleton 初始化失败后可以在后续挂载中重试，但必须去重同一时刻的并发初始化。组件卸载或 source 改版后忽略旧 promise 结果。

### 8. 直接使用 Shiki core 并清理重复高亮路线

共享核心直接使用 `shiki/core`、JavaScript RegExp engine、`@shikijs/langs/*` 与 `@shikijs/themes/*` 的细粒度动态 import；不再通过 `react-shiki` 间接加载 full bundle。经全仓引用审计后，`react-shiki`、`react-syntax-highlighter` 与 Prism 相关依赖已移除，并已用 typecheck 与生产构建验证。

assistant-ui 当前依赖的 `@assistant-ui/react-markdown@0.14.5` 在
`CodeOverride` 中使用 `/language-(\w+)/`，会把 `shell-session` 截断为
`shell`，既丢失原始标签又错误选择 Bash grammar。仓库以 pnpm patch 将其改为读取
完整的非空白 language token；这是上游兼容补丁，不复制 renderer。依赖升级时先确认
上游是否已修复，再决定移除或重做补丁。

构建记录显示 `.next/static/chunks` 总量由约 2420 KiB 变为约 3648 KiB；这是全项目汇总而非单一路由数值。最终生产构建的 `/thread-chat/[treeId]` client-reference manifest 为 14,814 bytes；此前 dev 目录的约 1.2 MB 同名中间产物不可用于 production 对比。因缺少基线 production manifest，不推断 route 级增量。

## Risks / Trade-offs

- **[首次高亮存在异步延迟]** → 流式和加载期间始终显示可复制的 plaintext，并复用 singleton 降低后续延迟。
- **[Shiki grammar/theme 增加客户端 bundle]** → 使用 JavaScript RegExp engine、10 个 grammar 与 2 个 theme 的细粒度动态 import；全项目 chunks 的构建汇总增量已记录，但不虚构单 route 基线。
- **[异步结果与快速 source 更新竞态]** → 为每次输入生成 revision，只提交仍匹配当前 revision 的结果。
- **[token DOM 的异步 React commit 覆盖命令式锚点标记]** → 由 Markdown renderer 聚合 settled 状态，锚点层只在稳定通知后首次绘制，并在 revision 变化时重新解析和重绘。
- **[两条 renderer 的 UI 不完全相同]** → 共享核心契约与测试样本，代码框 chrome 继续归各表面负责。
- **[notation transformer 与 fence meta 方言不一致]** → 只支持文档化子集，未知 meta 忽略并保持原始代码。
- **[未知语言造成运行时异常]** → 在调用 highlighter 前规范化并校验语言，不支持的语言统一走 plaintext。

## Migration Plan

1. 建立共享配置、高亮核心和针对语言/fallback/竞态的测试，不接 UI。
2. 接通 assistant-ui 已有 adapter，验证 streaming 与 settled 状态。
3. 替换 Thread Chat fenced code renderer，并让列视图、Canvas 和 Artifact 通过共享 `MarkdownBody` 自动获得能力。
4. 接入 `MarkdownBody` settled revision 与 `AnchoredMarkdown` 重绘，覆盖刷新恢复、文本选择和锚点/脚注点击。
5. 完成样式、transformer、依赖审计和 bundle 对比。
6. 通过 typecheck、目标 lint、组件/交互测试和生产构建后发布。

若出现回归，可以按 renderer 独立回退到原 plaintext code component；数据格式没有变化，不需要迁移或回滚持久数据。

## Open Questions

- 初始受控语言集合是否覆盖仓库中的真实 Markdown 样本，需要在实现阶段通过 fixture/内容审计确认；新增语言仍须遵循显式导入和 bundle 验证。
- Thread Chat 页面完成 dark mode 后，代码框何时从固定 `vitesse-light` 改为随页面主题选择对应分支；在此之前保持浅色，避免与纸面 UI 割裂。
