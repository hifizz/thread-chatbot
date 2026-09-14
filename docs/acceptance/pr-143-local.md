# PR #143 验收结果

## 结论

PASS WITH ISSUES（本次修复后的本地版本）。原 PR 存在类型错误、桌面/手机浮层遮挡和 Markdown 选区校验错误，已修复。手机原生长按手柄与系统软键盘仍需真机补验，不能把桌面模拟视为真机通过。

验收基线：`bccd68c`，分支 `docs/markdown-artifact-forks`，2026-09-14。使用 `pnpm dev`、本地 ego-browser、配置中的测试账号、真实 GPT-5.6 Luna。独立数据库为 `wt_docs-markdown-artifact-forks`，已有 `fork_artifact_id`；未运行 migration 生成或修改 migration 文件。

## Typecheck

PASS。初次发现 7 处错误，修复后通过。修改的 TS/TSX 文件 ESLint 通过，`git diff --check` 通过。

## OpenSpec

PASS，37/37。

## Desktop

PASS。真实鼠标拖选、单一「此处提问」动作、自动聚焦、输入提交、临时高亮、取消清理。普通 Message 仍保留「在当前对话问」「此处提问」。

## Mobile

PARTIAL。ego Chromium 的 390×844 手机视口和 Selection API 模拟选区通过：稳定采集、原生选区清空后 Quote 保留、自动聚焦、收起/重开草稿保留、无重复 toolbar、关闭 Drawer 不关闭 Project Panel、带问题提交。将可视高度缩到 520px 后 Drawer 保持在视口内。原生长按未在该桌面模拟环境产生可用手柄，未完整验收真机手柄拖动及系统软键盘。

## Artifact → Fork

PASS。带问题与留空两条入口通过；留空无消息、无模型生成、预填问题及 Quote。浏览器创建的分支直接查库核对 `parentId = artifact.threadId`、`forkMessageId = artifact.sourceMessageId`，并检查 `forkArtifactId/forkAnchor/anchorText/forkContext`。在浏览其他分支时从 Artifact 开分支仍挂到 Artifact 来源。刷新后恢复正确。

## Artifact Context

PASS。真实模型正确返回未划选的 A 文档“500 道测试题／蓝鲸-143-A”、B 文档“900 题／红狐-143-B”。数据库回归以来源 assistant 仅含工具、没有普通正文为前提，调用真正的 `compileModelContext` 和 AI SDK 转换，确认完整内容保留。不完整工具、缺失 input/content、未完成和 preliminary 工具均补入数据库正文。

## Context Dedup

PASS。完整工具输入、身份与数据库匹配时正文只出现一次，后续为固定引用标记。原有 `artifact-reference-context` 测试覆盖 title/content/sourceMessageId/artifactId 不匹配、动态工具、前缀稳定和消息不变性。

## Descendant Inheritance

PASS。新增数据库回归构造 Artifact Thread → Message Fork → Message Fork，逐代检查最终模型消息。并在源工具输入缺失时复测最深后代，全文仍存在。

## Source Navigation

PASS。A/B 包含相同原句，从 B 分支实际点击来源只打开 B 并高亮该句。高亮约 1.8 秒后清除；同一已打开 Artifact 的重复导航事件可重新高亮。错误选区只打开目标文档，不高亮其他文本。源码重试有 8 次上限，每次间隔 60ms。Artifact Fork 不进入来源 Message 的正文高亮列表。

## Quote Delete Semantics

PASS。浏览器删除 Quote 后发送纯文本，User Message 未恢复 Quote；直接编译该真实分支的模型上下文，未出现 `<quote>`。模型仍正确回答全文中的数据集和暗号。`sendMessage` 中 frozenFirstQuote 仅供校验，`resolveUserContent` 不向输入追加 Quote。

## 发现的问题与修复

1. `InlineUserContent` 用兼容旧格式的 schema 解析后，TypeScript 无法由 `schemaVersion` 收窄出 `source`；改用严格 v1 schema 识别可导航引用，旧 Quote 仍正常展示。
2. `mock-v1-runtime.forkThread` 仍假定旧 anchor 字段必填；改为先读 `target.anchor`，兼容旧字段，并保存 Artifact 身份。`StoreBoundProjectPanel` 浏览器 timer 误用 Node Timeout 类型，改为 number。
3. `styles/tokens/z-index.css` 的 selection 层级 60 低于 Project Panel 65，真实点击被遮挡；提高到 68，仍低于确认层 70。
4. `SelectionQuestionDrawer` 的通用 Drawer 门户层级 50，手机输入/提交被 Project Panel 遮挡；`DrawerContent` 增加可选 portalClassName，划选门户使用固定全屏的独立层级，不改变其他 Drawer。验证门户未增加页面高度。
5. `StoreBoundProjectPanel` 把来源事件只写入 ref，effect 仅依赖 open/activeId，同一已打开文档不重新定位；改为状态驱动每次来源请求，同时保持有界重试和高亮清理。
6. `markdownVisibleText` 正则会破坏 `judge_score`、代码比较符和转义字符，且未解码 HTML 实体。改用页面同族 unified/remark-parse/remark-gfm/remark-math 解析可见文字；新增直接依赖仅沿用已安装版本。浏览器 `judge_score` 划选开分支与专项回归均通过。

## 测试记录

通过：`fork-quote`、`artifact-reference-context`、`artifact-content-core`、新增 `artifact-fork-db`、新增 `markdown-visible-text`、`artifact-content-db`、`fork-model`、`markdown-artifact`、`message-artifacts`、`mobile-selection-observer`、`selection-observer-ownership`、`selection-placement-map-ownership`、`normalized-client-store`、`normalized-v1-api-contract`、`artifact-drawer-css`、`artifact-drawer-copy`。

两个已有测试问题未归因于本 PR：

- GitHub deterministic 失败在 `search-abort.test.mjs:31`，对 `research-tools.ts` 源码解构形式的正则计数得到 undefined 而非 2。该测试和搜索实现相对 main 均无修改；日志中实际 abort 行为测试先通过。
- 本地 `artifact-drawer-accessibility.test.mjs` 仍断言旧 `artifact-drawer.tsx` 直接包含 dialog/focus 代码，但该组件已成为 ProjectPanel 适配层。该测试与适配层相对 main 均无修改。

Vercel Preview 当前失败不作为本地 Typecheck/构建失败的证据；本次未运行生产 build，也未重新验证 Preview 迁移日志。

## 建议修改

1. 合并本次修复后，补做 iOS/Android 真机原生选区手柄及系统软键盘验收。
2. 单独更新上述两个陈旧的源码结构断言。
3. 按既定 develop 集成策略生成 additive migration，并验证旧数据库升级；本次未改变此策略。

验收数据保留在本地测试账号 Project：`http://localhost:4052/thread-chat/6b8eb875-ddcc-45d7-9d10-3c42f4cd9224`。
