# Markdown 语法高亮调研

> 调研日期：2026-07-29
> 目标：为 Thread Chat 与 assistant-ui 消息中的 fenced code block 建立一致、可靠且适合纯前端流式 Markdown 的语法高亮方案。

## 1. 结论摘要

本项目最终采用直接调用 Shiki 4.3.1 core 的纯前端路线，而不是保留 Assistant UI 示例中的 `react-shiki` 包装层：

1. 保留现有 Markdown parser，不把整个 Markdown 文档交给异步 rehype 管线重做。
2. 行内代码继续使用现有轻量样式，只有 fenced code block 进入 Shiki。
3. 流式阶段渲染纯文本代码，不执行 tokenization；消息稳定后再异步高亮一次。
4. 浏览器端复用单例 highlighter，使用 Shiki JavaScript RegExp engine 与细粒度 bundle。
5. 未知或不支持的语言降级为 plaintext，不能阻断 Markdown 正文渲染。
6. Thread Chat 的 Shiki 异步渲染完成后必须通知锚点系统重绘，避免手绘分支锚点被 React 替换代码子树时抹掉。

Assistant UI 的渲染时机与这套方案基本一致。需要针对本项目补充的是：

- Thread Chat 不在 assistant-ui runtime 内，不能直接依赖 assistant-ui 的 `INTERNAL.useSmoothStatus()`。
- Thread Chat 存在 `.md-body` 手绘锚点和脚注，需要额外处理异步 DOM 稳定事件。
- 已将实现收敛为受控的 10 个 grammar、2 个 theme、JS RegExp engine；Shiki 核心只在稳定代码块首次出现时动态加载。

## 2. 当前仓库状态

仓库内有两条独立的 Markdown 渲染链路。

### 2.1 Thread Chat

`app/thread-chat/chat/message/markdown-body.tsx` 使用：

- `react-markdown`
- `remark-gfm`
- 自定义 `CodeBlock`

fenced code block 已通过共享 `ShikiCode` 组件获得 token 级语法高亮，同时保留语言标签、复制按钮和原始代码复制语义。Thread Chat 页面尚未具备 dark mode，因此代码框固定使用 `vitesse-light` 和浅色 chrome；未来页面完成 dark mode 后再让其随主题切换。

`MarkdownBody` 同时用于：

- Thread Chat assistant 正文
- Canvas 展开消息
- Markdown Artifact drawer

因此在 `MarkdownBody` 接入高亮会同时覆盖普通回复和 Markdown Artifact。

### 2.2 assistant-ui

`components/assistant-ui/shiki-highlighter.tsx` 以 Assistant UI 官方 registry 的 streaming 状态适配思路为起点，现已接入 `markdown-text.tsx`：

- 流式状态下保留 plaintext
- 内容稳定后交给共享 `ShikiCode` 组件
- 通过全站 `ThemeProvider` 选择 `vitesse-light` / `vitesse-dark`

依赖审计与实现结果：

- 直接使用 `shiki@4.3.1` 与 `@shikijs/transformers@4.3.1`；
- `react-shiki`、`react-syntax-highlighter` 及其 Prism 路线已移除；
- 无需让 Thread Chat 依赖 assistant-ui runtime，两个 renderer 只共享配置和浏览器高亮核心。
- `@assistant-ui/react-markdown@0.14.5` 的 fenced-language 正则原本只匹配
  `\w`，会把 `shell-session` 截成 `shell` 并误用 Bash grammar。仓库通过 pnpm
  patch 将其收紧为完整的非空白 language token；补丁随 lockfile 固定，升级该依赖时
  必须重新审计是否已由上游修复。

## 3. prose-atelier 参考实现

参考库：

`/Users/zilin/side/article-template/packages/prose-atelier`

它把语法高亮拆成两层。

### 3.1 Shiki 配置层

`src/rehype-shiki.mjs` 定义：

- `vitesse-light` / `vitesse-dark`
- 常用语言别名
- notation diff/focus/highlight/word/error transformers
- fence meta 行高亮和词高亮
- 未标注语言时使用 `text`

值得复用的别名包括：

```text
js → javascript
ts → typescript
jsx → javascriptreact
tsx → typescriptreact
md → markdown
py → python
rs → rust
sh/zsh/shell → bash
```

### 3.2 CodeBlock UI 层

`src/code-block.tsx` 提供：

- 语言标签
- 复制原始代码
- 长代码折叠
- output/console/log 等输出面板变体

本次语法高亮需求只需要复用配置思想与现有复制交互，不应顺带引入 Mermaid、文章布局或长代码折叠等无关范围。

### 3.3 为什么不能直接照搬 rehype 管线

`prose-atelier` 的 `@shikijs/rehype` 运行在 MDX 编译、服务端或构建期。Thread Chat 则是：

- 纯客户端 Markdown
- 模型输出持续增量变化
- `useSmoothText` 会进一步产生逐帧显示状态
- 渲染后还会直接修改真实 DOM 绘制分支锚点

若在浏览器对整棵 Markdown HAST 运行异步 Shiki：

- 每次增量都可能重新处理整棵树
- 容易造成主线程开销和布局抖动
- 会扩大 React reconcile 与手绘 DOM 的冲突面

因此更适合保留 parser，只让 fenced code block 独立异步高亮。

## 4. Assistant UI 官方方案

Assistant UI 文档当前展示两种语法高亮集成：

1. `react-shiki`：官方推荐，支持动态语言，面向新实现。
2. `react-syntax-highlighter`：Prism/Highlight.js 路线，已标为 legacy，未来可能移除。

其推荐流程为：

```text
MarkdownTextPrimitive
        │
        ▼
识别 fenced code block
        │
        ├─ INTERNAL.useSmoothStatus() 仍为 running
        │       └─ PlainCode，不运行 Shiki
        │
        └─ smooth status settled
                └─ shared Shiki core
                        └─ codeToHast → React elements
```

优点：

- 流式阶段不做高成本 tokenization。
- Shiki 未完成时有纯文本 fallback。
- 高亮结果是 React/HAST，不需要 `dangerouslySetInnerHTML`。
- 支持 full、web 与自定义 core bundle。
- 支持 light/dark 多主题。

本项目没有直接采用该示例的包装层，原因是需要让 Thread Chat 与 assistant-ui 共享同一个、与运行时无关的核心。示例仍说明了正确的产品时机；其默认实现则有两个可优化点：

- `react-shiki` 主入口包含 full bundle。
- 默认使用 Oniguruma WASM。

对浏览器场景，Shiki 官方更推荐 JavaScript RegExp engine、单例 highlighter 和 fine-grained bundle。

## 5. Codex、ChatGPT、Kimi 与 Claude 调研

需要区分 Web 产品、桌面产品和 terminal/TUI 产品。界面上都显示彩色代码，并不意味着底层使用同一个库。

### 5.1 Codex CLI

OpenAI Codex CLI 的公开 Rust 仓库使用：

- `syntect`
- `two-face`
- 专门的 `codex-rs/tui/src/render/highlight.rs`

`syntect` 和 Shiki 都以 TextMate grammar/theme 为核心，但输出目标不同：

```text
               TextMate grammar
                 ┌──────┴──────┐
                 ▼             ▼
              syntect         Shiki
                 │             │
                 ▼             ▼
            ANSI terminal   HAST / HTML
```

Codex CLI 的价值在于验证以下工程原则：

- 复用语法与主题实例。
- 按行维护 tokenizer 状态。
- 语言识别失败时稳定降级。
- terminal 与 browser 使用适合各自平台的渲染后端。

公开的 Codex CLI 实现不能代表未完整开源的 Codex Web/Desktop UI。

### 5.2 Kimi CLI

Kimi CLI 依赖 Python `rich`，并维护自己的：

- `src/kimi_cli/utils/rich/markdown.py`
- `src/kimi_cli/utils/rich/syntax.py`

Rich 使用 Pygments 完成语法高亮，因此其大致链路为：

```text
Markdown fence → Rich Markdown/Syntax → Pygments lexer → ANSI colors
```

这同样是 terminal 方案，不适用于浏览器，但验证了 fenced code、语言 lexer、theme 和 fallback 分层的设计。

Kimi Web 的具体高亮库没有公开证据，不能从产品外观反推它使用 Shiki、Prism 或 Highlight.js。

### 5.3 Claude Code

Claude Code 官方 changelog 能确认：

- 已切换到新的 native syntax highlighting engine。
- 可以在主题界面关闭语法高亮。
- 修复过多行结构中的 diff 高亮。
- 修复过 Markdown/highlight cache 持有完整内容导致的内存增长。

当前 native engine 的完整实现没有公开。

对本项目最重要的启示是：

- 可以缓存高成本的 highlighter、language 和 theme。
- 不应建立一个按完整 Markdown/code 字符串无限增长的全局结果缓存。

Claude Web 的具体库同样没有可靠公开信息。

### 5.4 ChatGPT Web

ChatGPT Web 能观察到 fenced code、语言标签、复制等产品行为，但官方没有公开当前语法高亮库与流式 tokenization 实现。

因此不能可靠断言其使用 Shiki、Prism、Highlight.js 或自研方案。可参考的是产品行为，而不是未经证实的依赖名称：

- fenced code 与 inline code 分离
- 显示语言标签
- 支持复制
- 未知语言仍能显示纯文本
- 高亮不应阻塞正文流式输出

## 6. Streamdown 备选方案

Assistant UI 还支持 `@assistant-ui/react-streamdown`：

- block-based 流式 Markdown
- 内置 Shiki plugin
- 不完整 Markdown 修复
- code copy/download controls
- KaTeX、Mermaid、CJK 插件
- `defer` 降低流式解析优先级

它适合需要完整“AI 流式 Markdown renderer”能力的新界面，但目前不建议为了语法高亮直接迁移 Thread Chat：

- 会替换现有 Markdown renderer，而不是只增加高亮。
- 可能改变 `.md-body` 的文本节点结构和更新时机。
- 与 `locateAnchor`、`paintRange`、脚注插入的兼容性需要独立设计。
- 需求范围会扩张到不完整 Markdown、Mermaid、KaTeX 和安全策略。

若未来需要这些能力，应作为独立 renderer migration 调研，而不是语法高亮需求的默认实现。

## 7. 最终架构

```text
Markdown source
      │
      ▼
react-markdown / MarkdownTextPrimitive
      │
      ├── inline code ─────────────► 现有轻量样式
      │
      └── fenced code
             │
             ├── streaming ────────► PlainCode
             │
             └── settled/artifact ─► 动态加载的 shared browser Shiki
                                      │
                                      ├─ singleton highlighter
                                      ├─ JavaScript RegExp engine
                                      ├─ fine-grained languages/themes
                                      ├─ 10 个受控 grammar、2 个 theme
                                      ├─ aliases + transformers
                                      └─ HAST → React elements
```

实现已建立一个与 UI 框架无关的 Shiki 配置/基础渲染层，再提供两个 adapter：

1. assistant-ui adapter：读取 `INTERNAL.useSmoothStatus()` 判断 streaming；即使底层 part 已结束，smooth/defer 显示层仍在追帧时也保持 plaintext，直到 smooth status 稳定后才调用 Shiki。
2. Thread Chat adapter：由 `AnchoredMarkdown` 显式传入 `active`。

这样两套 Markdown renderer 可以共享：

- 主题
- 支持语言
- language alias
- transformer
- fallback
- bundle 与 engine

但不会让 Thread Chat 依赖 assistant-ui runtime。

## 8. Thread Chat 特有风险：锚点重绘

`AnchoredMarkdown` 会在 `.md-body` 上直接绘制：

- `data-text-anchor-mark`
- `data-fork-id`
- `sup.fn-mark`

Shiki 异步完成时会把：

```html
<code>const x = 1</code>
```

替换为 token spans：

```html
<code>
  <span class="line">
    <span style="color: ...">const</span>
    ...
  </span>
</code>
```

若页面加载时已有 fork，可能发生：

```text
锚点 effect 先运行
    ↓
在纯文本 code 上绘制锚点
    ↓
Shiki 异步完成
    ↓
React 替换 code 子树
    ↓
代码范围内的锚点丢失
```

因此实现必须提供明确的 `highlight settled` 信号，使 `AnchoredMarkdown` 在代码 DOM 稳定后重新执行定位和绘制。

不建议依赖“通常语言加载得很快”或无限 MutationObserver；该行为需要可测试的显式契约。

## 9. 实施范围与已知限制

### 已完成

- Thread Chat 与 assistant-ui 都已接入 Shiki；Artifact、列视图和 Canvas 展开视图通过共享 `MarkdownBody` 覆盖。
- 流式阶段不进行 Shiki tokenization；未知语言、无语言和单块失败均降级 plaintext。
- 支持 `js/ts/jsx/tsx/json/html/css/bash/python/markdown` 十个 grammar 及常用 alias；两个显式 theme 为 `vitesse-light` 与 `vitesse-dark`，采用 Vitest/Vite 生态常见的 Vitesse 配色。
- Thread Chat 固定浅色代码框；assistant-ui 跟随应用 light/dark 主题。
- 复制始终读取原始代码，transformer 不改变复制文本；不启用 raw HTML。
- `MarkdownBody` 的 settled revision 会触发 `AnchoredMarkdown` 重绘，避免异步 token DOM 覆盖持久锚点。
- 不建立按完整 Markdown/code 内容的全局结果缓存；只复用 highlighter、grammar 和 theme。

### bundle 记录

- 生产构建的 `.next/static/chunks` 汇总体积：基线约 **2420 KiB**，最终约 **3648 KiB**，增量约 **1228 KiB**。这是全项目 chunk 汇总，不应被解读为 `/thread-chat` 单一路由的精确增量。
- 最终生产构建中 `/thread-chat/[treeId]` 的 client-reference manifest 为
  **14,814 bytes**。此前 dev 构建目录曾出现约 1.2 MB 的同名中间产物，不能与
  production manifest 混用；又因没有可比的基线 route manifest，因此仍不推断 route
  级精确差值。
- 受控 grammar/theme 通过 `shiki/core` 与动态 import 进入独立异步路径；无 fenced code 或内容仍在 streaming 时不会初始化 Shiki 核心。
- 已移除 `react-shiki` 与 Prism / `react-syntax-highlighter` 路线，避免两个高亮引擎并存。

### 已知限制与后续项

- Thread Chat 暂未完成页面级 dark mode，故代码块有意固定为浅色；这是与当前纸面 UI 一致的过渡策略。
- 不支持 `prose-atelier` 的全部文章 UI、Mermaid、KaTeX、Twoslash、长代码折叠、服务端预高亮或 Web Worker。
- grammar 集合为受控白名单；新增语言必须显式加入并重做 bundle 评估。

### 非目标

- 替换整个 Markdown renderer。
- 迁移到 Streamdown。
- Mermaid、KaTeX 或 Twoslash。
- 代码编辑器、运行代码或 Monaco。
- 服务端/RSC 预高亮。
- Web Worker，除非性能数据证明主线程仍存在明显阻塞。

## 10. 验收结果

- [x] 受控十种语言、常用 alias、未知语言 plaintext 与 inline code 分流。
- [x] streaming plaintext、settled 后单次异步高亮、原文复制和局部失败降级。
- [x] Artifact 与 Thread Chat 多视图复用、assistant-ui 主题跟随、Thread Chat 浅色固定主题。
- [x] singleton、无 code-string 全局缓存、bundle 记录和旧高亮依赖清理。
- [x] settled revision 后的锚点重绘契约。
- [ ] 浏览器端的最终人工交互验收（主题切换、Artifact、未知语言、刷新后锚点）仍应在发布前完成。

## 11. 参考资料

- [Assistant UI：Syntax Highlighting](https://www.assistant-ui.com/docs/ui/syntax-highlighting)
- [Assistant UI：Streamdown Markdown Renderer](https://www.assistant-ui.com/docs/ui/streamdown)
- [Shiki：Bundles](https://shiki.style/guide/bundles)
- [Shiki：Best Performance Practices](https://shiki.style/guide/best-performance)
- [Shiki：RegExp Engines](https://shiki.style/guide/regex-engines)
- [Shiki：Common Transformers](https://shiki.style/packages/transformers)
- [Shiki：Stream](https://shiki.style/packages/stream)
- [OpenAI Codex `highlight.rs`](https://github.com/openai/codex/blob/d06c7ac055920c7cb140c25ebda3f3db20197b45/codex-rs/tui/src/render/highlight.rs)
- [OpenAI Codex Cargo.lock](https://raw.githubusercontent.com/openai/codex/main/codex-rs/Cargo.lock)
- [Kimi CLI `markdown.py`](https://github.com/MoonshotAI/kimi-cli/blob/4a550effdfcb29a25a5d325bf935296cc50cd417/src/kimi_cli/utils/rich/markdown.py)
- [Kimi CLI `syntax.py`](https://github.com/MoonshotAI/kimi-cli/blob/4a550effdfcb29a25a5d325bf935296cc50cd417/src/kimi_cli/utils/rich/syntax.py)
- [Rich](https://github.com/Textualize/rich)
- [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
