# 实现与验证记录

## 基线与范围

基于 main `7da00eaba9fb116a4ff4612b08005f51e886cd45`，基础实现父提交 `a8a854b27636654b7f9d217ecf0da2203c5c3be4`。本记录对应随附代码的实现提交。2026-09-07 再次 fetch 后，main 和实现分支远端没有其他新增提交。#93 仅作行为参考，不合并或关闭。

用户已确认旧 Quote 方案：只读可删除，保留相对顺序，不做拖动、排序、复制、新增 Quote 或修改评论。旧 `{text}` 仅在编辑时按原快照子序列校验；新消息拒绝旧版 Quote。Annotation 提问、评论及列表交互是后续范围。先前的协议暂停已解除。

## 实现

- `contracts/message-content.ts` 定义内容 Schema、完整草稿往返、保序规范化。文件、Quote 和引用与文本在同一序列，不按类型重拼。旧的 text/files 内部命令和自动插回 Quote 的 domain 辅助函数已移除。
- send/edit/start/fork 都在已有锁、事务和幂等机制内调用 `resolveUserContent`。空分叉首次发送的父级 Quote 匹配数据库中冻结的分叉快照，既不重新插入，也不扩大到任意父级来源。
- Repository 仅批量读取当前 Project 的 Artifact。新选择要求 completed Markdown；编辑保留引用使用原快照。Artifact finalization 的条件更新和插入不覆盖同 ID 内容，无表结构或 migration 改动。
- 模型引用展开归位 application，实际历史及附件处理后前向编译，再调用真实 AI SDK 转换；固定重复标记、完整源工具核对及前缀字节稳定测试保留。
- 最终请求边界记录总预算状态。目前模型配置没有完整输入 tokenizer 或上下文上限，明确为 `unknown`；不会声称已完成总 token 预检。纯预算函数覆盖已知总量与输出预留，提供商超限在异常和 SDK failed outcome 两条路径统一转换。字符接收预算不作为 token 估算。
- 输入框按 Lexical 0.45.0 官方 TextNode/token、PlainText、History、OnChange、Command、Typeahead 拆分，唯一 codec 连接活动文档和完整草稿。上传占据固定 localId 位置，异步更新只替换该节点。成功清理匹配快照，迟到结果不覆盖新内容。
- 草稿、normalized 资源订阅和历史导航使用独立 Provider。历史消息按 Parts 顺序展示，编辑恢复全部内容。引用菜单关闭时不搜索，无关流式状态不重建候选。
- 官方默认 Typeahead 在底部单行输入框没有翻转（最小复现 y=663、菜单高240、视口700）。现通过公开 onOpen/MenuResolution/menuRenderFn 配合官方 NodeContextMenuPlugin 已使用的 Floating UI 实现：仅定位自己渲染的菜单，不修改 Lexical anchor/firstChild 或使用内部字段。Floating UI autoUpdate 仅在菜单挂载期间运行，跟踪画布 transform。
- 直接依赖声明 lexical、@lexical/react、@floating-ui/react，锁文件 frozen/offline 安装通过；去掉未使用的直接 @lexical/utils。

## 已执行的验证

环境：Node 24.19.0、pnpm 10.32.1、Linux、Chromium 149。每批 TypeScript 改动运行 `pnpm typecheck`，最后类型检查和修改文件 ESLint 均通过。未执行格式化或生成 migration。

以下执行方式为 `node --import tsx e2e/thread-chat/<名称>.test.mjs`：

- artifact-content-core：交错内容往返、空格、重复引用、严格版本及伪造字段拒绝。
- artifact-reference-context：真实 AI SDK 转换；自身/分叉/裁剪历史、完整与临时工具、来源身份、固定标记、前缀稳定。
- context-budget：已知边界、输出预留、unknown、嵌套提供商错误及循环保护。
- fork-quote、prompt-cache-contract、normalized-client-store：结构化首问、空分叉、无效首问、完整编辑、旧 Quote、命令协议与 Store 回归。
- conversation-composer、text-attachment-slice、image-attachment-slice：Enter/Shift/IME 事件守卫、粘贴阈值、附件类型和图片数量限制。IME 守卫测试不等于系统输入法验收。
- artifact-content-db、fork-quote-db：真实应用命令、Drizzle/postgres-js SQL 和事务在隔离 PGlite PostgreSQL 引擎中执行，通过 db:push 初始化独立内存数据库。覆盖权限、跨 Project、状态和伪造拒绝且无半消息；200,000 字符边界、合计超限、重复正文只计一次；跨 Thread/当前 Thread 引用、读取恢复、幂等、旧快照编辑、旧 Quote 保留/删除、两种分叉入口、终态不可覆盖。未使用普通 JS 数据库替身；但此环境不是独立原生 PostgreSQL 多连接部署，不能据此声明并发数据库或整链路 E2E 验收通过。

实际浏览器用例已保存为 `e2e/thread-chat/content-browser.test.mjs`，测试页面为开发环境专用 `/thread-chat-gate-3-harness/content`。可用 `TEST_BASE_URL` 和 `CHROMIUM_EXECUTABLE_PATH` 指定地址与浏览器。本环境将同一 React 组件通过 esbuild 装载运行，未假称 Next 服务端或整站 E2E。

浏览器已通过：中文前缀 @、上下键与 Enter 选择后继续输入、底部菜单完整可见（y=416、高240、视口700）、菜单不增加页面滚动高度；Thread 和列/画布之间草稿恢复；发送失败保留；迟到成功不清理新输入或其他 Thread；胶囊原子删除与撤销；上传过程中切换 Thread，完成后文件保持原位置，文本/引用/文件提交保序。附件 HTTP 在这组测试使用可控替身，不代表 R2 验收。

## 尚未完成的验收

任务保持未完成：4.1、4.4、4.6、5.1、5.2。核心实现和上述局部证据已提供，仍需要：

- 可用真实模型凭据及独立原生 PostgreSQL 环境，执行生成、发送、刷新、编辑、分叉、重试的整条产品链路；当前没有进行付费模型调用。
- 实际系统中文输入法、剪贴板完整往返、手机软键盘；窄列与画布缩放/平移的完整布局矩阵。
- 真实消息编辑页面内 Quote/File/重复引用交错的浏览器验收。目前有协议/命令测试，不能替代此项 UI 证据。

因此当前为 draft PR，不宣称可发布，不归档 OpenSpec。本地组件测试、数据库引擎测试和真实模型 E2E 的证据明确分开。

## 回滚

无需数据库迁移。尚未保存新引用时可以回退本分支；已有引用写入后不能退回不认识 data-artifact-reference 的服务端。应关闭新引用入口，保留引用读取和模型展开，再修复。不得删掉引用或把历史指向新产物。
