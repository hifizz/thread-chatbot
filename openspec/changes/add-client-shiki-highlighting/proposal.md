## Why

Thread Chat 与 assistant-ui 的 Markdown 代码块此前缺少一致的 token 高亮；Thread Chat 也不能直接依赖 assistant-ui runtime。需要建立一套适合浏览器流式消息、Markdown Artifact 和分支锚点 DOM 契约的共享语法高亮能力。

## What Changes

- 为 fenced code block 增加纯前端 Shiki 语法高亮，同时保持 inline code 的现有轻量样式。
- 在消息流式生成期间保留 plaintext，内容稳定后再异步高亮；Markdown Artifact 等静态内容直接进入高亮。
- 为 Thread Chat 与 assistant-ui 提供共享的主题、语言别名、fallback 和 highlighter 生命周期，但保留各自的 streaming 状态 adapter。
- 将 assistant-ui 的 streaming adapter 接入 renderer，并让 Thread Chat 的 `MarkdownBody` 覆盖列视图、Canvas 展开视图和 Artifact drawer。
- 在 Shiki 异步替换代码 DOM 后触发 Thread Chat 锚点重绘，保证刷新恢复、文本选择和分支点击不被破坏。
- 控制浏览器 bundle 与运行时成本：复用 highlighter、明确支持语言、未知语言降级 plaintext，并避免按完整代码内容建立无界全局缓存。
- 对照 `prose-atelier` 支持常用语言别名和 notation/meta transformers，同时保持 raw HTML、Streamdown 迁移、Mermaid、KaTeX、Twoslash 与代码执行不在本次范围。

## Capabilities

### New Capabilities

- `markdown-syntax-highlighting`: 定义两套 Markdown renderer 的 fenced code 高亮、流式降级、语言与主题契约、异步 DOM 稳定通知、Thread Chat 锚点兼容、性能边界和依赖清理行为。

### Modified Capabilities

（无——`openspec/specs/` 当前没有既有 capability；Markdown Artifact 的历史 delta spec 已要求复用 `MarkdownBody`，本变更在该共享 renderer 上增加独立能力，不改变 Artifact 生成与生命周期契约。）

## Impact

- Markdown renderer：`app/thread-chat/chat/markdown-body.tsx`、`components/assistant-ui/markdown-text.tsx`、`components/assistant-ui/shiki-highlighter.tsx`。
- Thread Chat 锚点生命周期：`app/thread-chat/branching/branchable-chat.tsx` 及其列/Canvas 复用路径。
- 样式：`app/thread-chat/thread-chat.css` 与 assistant-ui 代码块样式。
- 依赖与 bundle：直接使用 Shiki 4.3.1 core、JS RegExp engine、细粒度 language/theme/transformer 入口；移除未使用的 `react-shiki` 与 Prism / `react-syntax-highlighter` 路线。
- assistant-ui 兼容：对 `@assistant-ui/react-markdown@0.14.5` 固定最小 pnpm patch，避免带连字符的未知语言被上游截断并误判为已知 grammar。
- 验证：Markdown renderer 单元/组件测试、Thread Chat 锚点恢复 e2e、typecheck、目标 ESLint、生产构建与客户端 bundle 对比。
- 数据库、API、Artifact JSON 结构和服务端聊天协议不变。
