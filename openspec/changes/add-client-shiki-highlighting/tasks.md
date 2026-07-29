## 1. 依赖与基线审计

- [x] 1.1 审计两条 Markdown renderer、所有 `MarkdownBody` 使用面、Shiki adapter 和锚点绘制路径，记录实现需要保持的 props、DOM class 与交互契约
- [x] 1.2 审计 `react-shiki`、Shiki 及 `react-syntax-highlighter` 的版本和全仓引用，确定升级/保留/移除方案并同步 `package.json` 与 lockfile
- [x] 1.3 记录变更前生产构建的客户端 bundle 基线，并确认初始受控语言与主题集合

## 2. 共享 Shiki 核心

- [x] 2.1 在共享 domain 模块中定义语言列表、别名、light/dark 主题家族、plaintext fallback 和受支持 fence meta 常量
- [x] 2.2 使用 JavaScript RegExp engine 和细粒度导入实现可去重初始化的 singleton highlighter，确保失败后可重试
- [x] 2.3 实现安全的异步高亮函数，支持语言规范化、未知语言 fallback、notation transformers 和输入 revision 竞态保护
- [x] 2.4 为语言别名、未知语言、初始化失败、transformer 和过期异步结果补充针对性测试
- [x] 2.5 运行 `pnpm typecheck`，修复共享核心批次产生的类型错误

## 3. assistant-ui 接入

- [x] 3.1 重构 `components/assistant-ui/shiki-highlighter.tsx` 以消费共享核心，同时保留代码原文、语言标签和复制行为
- [x] 3.2 将 Shiki adapter 注册到 `components/assistant-ui/markdown-text.tsx` 的 fenced code 渲染链路，并从 assistant-ui 状态读取 streaming/settled 状态
- [x] 3.3 验证 assistant-ui 在流式期间显示 plaintext、稳定后高亮、主题切换和未知语言 fallback
- [x] 3.4 运行 `pnpm typecheck` 和 assistant-ui 目标 lint，修复本批次问题

## 4. Thread Chat 与 Artifact 接入

- [x] 4.1 为 Thread Chat 新建消费共享核心的 fenced code component，保持现有 code chrome、语言标签、复制按钮和 inline code 行为
- [x] 4.2 在 `app/thread-chat/chat/markdown-body.tsx` 接入 fenced code component，并为 streaming、静态内容和 fence meta 传递明确状态
- [x] 4.3 验证列视图、Canvas 展开视图与 Markdown Artifact drawer 均通过共享 `MarkdownBody` 获得相同高亮和 fallback
- [x] 4.4 补充覆盖流式切换、静态 Artifact、HTML/脚本文本转义和原文复制的 renderer 测试
- [x] 4.5 运行 `pnpm typecheck` 和 Thread Chat 目标 lint，修复本批次问题

## 5. 锚点稳定与分支重绘

- [x] 5.1 为 `MarkdownBody` 增加按 source revision 聚合的内容稳定通知，确保所有当前代码块高亮或 fallback 后才完成
- [x] 5.2 让 `AnchoredMarkdown` 消费稳定 revision，重新查询 `.md-body` 并恢复持久锚点高亮、脚注与点击标记
- [x] 5.3 处理多代码块乱序完成、source 快速更新、组件卸载和高亮失败，确保旧回调不污染当前锚点
- [x] 5.4 补充刷新恢复、文本选择、锚点/脚注点击以及含代码块消息的持久锚点交互测试
- [x] 5.5 运行 `pnpm typecheck` 和锚点相关目标 lint，修复本批次问题

## 6. 样式、依赖清理与性能验证

- [x] 6.1 调整 Thread Chat 与 assistant-ui 代码块样式，使 token、notation、light/dark 主题、横向滚动和复制控件在现有布局中可用
- [x] 6.2 根据引用审计结果移除无用旧高亮依赖，或记录仍需保留的调用点与后续清理范围
- [x] 6.3 运行生产构建并记录 bundle 前后对比，确认未引入全量 grammar/theme 或按代码内容永久增长的全局缓存
- [x] 6.4 使用长代码块、多语言、多消息和快速 streaming 更新进行浏览器验证，检查首次高亮延迟、布局抖动和控制台错误

## 7. 最终验证与文档

- [x] 7.1 运行完整 `pnpm typecheck`、相关测试、目标 lint 和生产构建，并修复所有由本变更引入的问题
- [x] 7.2 对照 `markdown-syntax-highlighting` capability 的每个 scenario 完成验收，记录不能自动化的手工验证证据
- [x] 7.3 更新语法高亮调研文档和 GitHub Issue #16，记录最终依赖版本、支持语言/主题、bundle 结果、已知限制与完成状态
