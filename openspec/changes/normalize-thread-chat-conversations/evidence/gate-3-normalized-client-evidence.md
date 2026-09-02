# Gate 3 出场证据：规范化客户端 Store 与既有组件适配

日期：2026-08-27

## 规范化客户端边界

- `createConversationStore` 使用 `zustand/vanilla`，按 ID 保存 Project、Thread、Message、Artifact、stream 与 optimistic patch；工作区状态作为独立 slice 存在。
- selectors 从规范化 DTO 派生当前时间线、全部历史实体、树拓扑、lineage/children、来源、Artifact、标题和动作状态；当前时间线默认过滤 `supersededAt !== null` 的 Message。
- 根 Thread 的真实 UUID 只在现有 UI 兼容 facade 中投影成 `main`；v1 command、DTO 和 Store 始终使用真实 UUID。
- `parts[]` 通过 AI SDK v7 reducer 归并 snapshot/replay/chunk；断流只启动 Message terminal polling，不自动重连 SSE，也不使用 `Last-Event-ID`。
- 较新的内存 live snapshot 不被旧 generating checkpoint 回退；终态 DTO 原子收敛 Message，并按 tool output 的 Artifact ID 读取权威 ArtifactDTO。
- start/send/stop/fork/edit/retry/feedback/model/title/archive/delete 统一经过 v1 command orchestration；网络重试复用冻结 command ID、实体 ID 和完全相同的 payload。
- localStorage 只保存版本化 workspace（视图、打开列、选择、recents、画布、面板尺寸、展开状态），不保存 Message、Artifact、Project 内容或 active-leaf 权威字段。

## 既有组件与唯一可见变化

- 列视图、画布、Composer、模型选择、选择分叉、消息 toolbar、Artifact 抽屉、研究面板、标题、反馈、归档和删除均复用现有组件、DOM/CSS 与操作流程，通过规范化 selector facade 注入数据。
- 已删除 `turn-variant-picker.tsx`、客户端 active-leaf 切换 command、动作 capability、版本计数和对应样式；来源说明改为“历史回复”，不再提供切回入口。
- superseded Message 仍保留在规范化实体 Store 中，旧来源分支、frozen context 与 Artifact 溯源仍可解析。
- 正式 `/thread-chat` 的一次性 v1 cutover 属于 Gate 4；旧生产整树实现内部的 `activeLeafMessageId` 与旧服务端 API 仅作为尚未退役的 legacy 路径保留。它们不进入 normalized runtime、测试 harness 或 localStorage，也不再有可见切换 UI/客户端命令；Gate 4 task 5.5/5.7 将随旧路径一起删除。

## Gate 3 专用 harness

- 开发入口：`/thread-chat-gate-3-harness/:projectId`，仅 `NODE_ENV=development` 且 hostname 为 `localhost`/`127.0.0.1` 时绕过登录；生产 render 直接 `notFound()`。
- harness 复用实际 Topbar、ThreadColumns、ThreadCanvas、BranchableChat、SelectionBubble、Composer、消息 parts、ArtifactDrawer 和 workspace 组件。
- 仅在 v1 client/SSE 注入点使用可控 mock；源码测试确认不调用旧 `/api/chat`、`/api/branch-trees`，正式 `/thread-chat/[treeId]` 页面不导入 harness。
- 场景覆盖 normal、late SSE、disconnect→poll、failure→Retry、Artifact-only、research parts 和刷新 background recovery。

## ego-browser localhost 验收

使用 `ego-browser nodejs` 的独立 task space 22 完成真实页面操作，验收后已关闭 task space：

- 正常发送与完整 text/reasoning/source/research/Artifact parts 渲染通过。
- POST 后迟到 SSE replay 可立即显示；断流后只轮询，刷新后从 checkpoint/background poll 收敛；Stop 后不残留 Stop 控件。
- failed A Retry 创建新回复；Edit 追加新 turn；旧回复不在当前时间线展示，分支数量和 frozen 来源保持。
- 留空 Fork、带问 Fork、从 ForkedThread 再嵌套 Fork 均可创建，列视图与画布节点/边一致。
- Artifact-only 卡片、双 tab 抽屉、来源定位、研究面板和 source link 均保持。
- 模型选择、标题、反馈、归档、删除和 workspace 刷新恢复通过；删除后列数与 React Flow 节点数均为 0，并显示明确空状态。
- variant picker、版本数量、上一版/下一版和切回入口均不存在。
- 修正开发 harness 的 `window.innerWidth` hydration 差异后，Next.js issue overlay 为 0。
- 除已批准的 variant 能力移除外，未发现需要用户决策的 UX/UI 冲突。

## 自动化验证

- `pnpm test:thread-chat:gate3-client`：通过
  - bootstrap/空壳、normalized merge、AI SDK v7 replay/chunks、one-shot SSE、terminal poll、断流、刷新 background、optimistic rollback、A→B→C、旧分支、Artifact/research、workspace 隔离、冻结 payload 和 harness 边界。
- 44 个既有 UI/组件/样式 Node 回归脚本：通过
  - 列、画布、Composer、消息状态、Artifact、selection、树/切换器、workspace、Markdown 高亮、研究来源、消息动作与 variant 移除后的 contract。
- `pnpm typecheck`：通过。
- `pnpm lint`：0 errors；仅 3 个既有、与本 Gate 无关的 warnings。
- `node scripts/check-thread-chat-v1-boundaries.mjs`：通过；无 billing/payments/usage-store/旧 generation import。
- `pnpm openspec:validate`：26 passed，0 failed。
- `git diff --check`：通过。

## 非 Gate 3 阻断项

额外尝试 `pnpm build` 两次，均在既有 `next/font/google` 下载 Inter/Geist Mono 时因当前执行环境无法连接 `fonts.gstatic.com` 失败；失败发生在字体资源下载阶段，不是 TypeScript、lint 或 Gate 3 源码错误。Gate 3 任务未要求 build，未为绕过网络问题修改字体或 UI；Gate 4 task 5.10 将在可访问字体资源的构建环境重新执行正式 build。
