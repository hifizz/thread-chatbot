# 阶段 9 前后端集成与 E2E 证据

日期：2026-08-25
环境：`thread-chat-test` PostgreSQL、Next.js `http://localhost:4040`、Ego Browser task space `11`、`1674 × 963` viewport。

## 最终清理复验

- Domain change 归档后重新执行 87/87 自动测试、`pnpm typecheck` 与默认 Turbopack `pnpm build`，全部通过。
- Ego Browser 在隔离 `thread-chat-test` + Fake AI Runtime 上再次验证 `/new` 创建、服务端 `projectId` URL、SSE 完成与硬刷新恢复；刷新前后 prompt/reply 均存在，URL 不含旧 tree 路径。
- 清理前的完整交互矩阵与 UI parity 证据保留如下；清理只替换权威数据路径并删除退役代码，未改变既有 UI 输出。

## 确定性 AI Runtime

- 本地 E2E 没有调用真实模型。服务端仅在 `NODE_ENV !== production` 且
  `DATABASE_URL` 的数据库名严格等于 `thread-chat-test` 时自动使用
  `IsolatedTestAiRuntime`。
- 该选择没有 feature flag，也不接受任意环境变量覆盖；production 或任何非 allowlist
  数据库始终走真实 `AiSdkRuntime`。
- Runtime 用自然测试输入提供确定性完成、慢生成、显式 Stop 和 Markdown Artifact，单元测试
  覆盖选择边界、delta/terminal、Artifact 与 abort。

## 自动集成测试

- `/new`：无实体草稿只提交 user parts；CreationBundle 先 seed 唯一 Project Runtime、先订阅
  assistant SSE，再执行 route replace。测试让 terminal event 早于目标 Provider 挂载，确认
  handoff 不丢事件且不二次 Bootstrap。
- Project 冷启动：Bootstrap 完成前保持 loading；无 Snapshot 使用默认 Root 视图，有合法
  Snapshot 时在 Bootstrap 后恢复稳定 Slot、焦点、Root/Branch 宽度和列数。
- Branch 并行加载：两个不同 Thread 同时发起 Message Query；一个成功、一个失败，失败状态只
  落在目标 Thread，Root 和成功 Branch 仍为 ready。
- running Run 刷新恢复：Bootstrap 返回既有 running Run 后，Coordinator 以同一
  `assistantMessageId` 和持久 `eventSequence` 订阅并进入 completed，没有创建第二个 Run。

## Ego Browser E2E

- 通过 UI 注册专用本地账号 `thread-chat-e2e-20260825@example.com`；没有真实邮箱验证。
- `/new` 首次发送创建服务端 Project 并 replace 到
  `/thread-chat/da6e6e77-83f3-4bd9-88ea-7c29ff32ed0d`。逐帧探针记录 212 帧，其中
  172 帧位于目标路由，`blankProjectFrames=0`、`loadingProjectFrames=0`。
- 首条和后续消息均得到确定性回复。输入“E2E 刷新恢复”时先观察持久 checkpoint 和 Stop，
  生成中刷新后立即恢复同一 partial，随后进入 completed。
- 输入“请持续生成，直到我停止”后点击显式 Stop；最终保留 checkpoint，后台状态和 Stop
  控件消失，没有把 SSE 断开当作 Stop。
- Edit 把最后一轮有效 user Message 替换为“E2E 编辑后的消息”并生成新 assistant；
  Regenerate 再次生成不同 assistant ID 后缀的回复，旧 finalized 内容没有原地改写。
- 从 completed assistant 划选原文创建 L1 Fork，再从 L1 assistant 创建 L2 嵌套 Fork；
  页面显示 Root/L1/L2 三栏，三个 Message Query 和生成互不阻塞。
- Header Child 选择器可在收起 L2 后重新打开既有 Thread；重复 Thread 的 `⇄ 切换`交换两个
  物理 Slot，再次切换可恢复原顺序；L2 breadcrumb 回到已打开 L1 时只收起重复后代列。
- 三栏初始宽度约 `558 / 558 / 557px`。第一条分割线向右拖 `80px` 后为
  `638 / 478 / 557px`，只改变相邻列；刷新后恢复相同 Thread ID、L1/L2 层级与列宽。
- 嵌套 Branch 请求 Markdown 后，消息 API 的 tool output 只含
  `artifactId=0516d587-5d46-45af-9f15-520bb078627f`，没有正文；消息卡片和 Header 计数为 1，
  Drawer 按 ID 加载标题与正文。
- 在隔离测试库临时建立另一个 owner 的 Project。当前浏览器 session 请求其 Bootstrap 得到
  HTTP 404，Project list 不泄露该 ID；断言完成后临时 owner 已级联删除，残留计数为 0。

## UI parity

阶段 9 沿用阶段 8 的同一 Ego Browser task space、账号、viewport、组件和 CSS 类，并逐项重放
空白页、三栏、Header Child、Switcher、收起、breadcrumb、Fork Composer、Artifact Drawer
和分割线交互。对照 `ui-parity-baseline/` 与 `ui-parity-implementation/`，除规范批准的
Project/Artifact 异步 loading/error 外，没有发现最终样式、布局或交互输出变化。

## 阶段验收

- `pnpm test`：87 项通过（17 unit、17 client、20 PostgreSQL integration、33 API）。
- `pnpm typecheck`：通过。
- `pnpm lint`：0 errors；3 个既有 warnings。
- `pnpm openspec:validate`：27 个 change/spec 严格校验全部通过。
- Next.js production build：默认 Turbopack 在受限网络请求 Google Fonts 时持续等待且 0% CPU；
  停止该单一构建进程后，使用 Next.js 16.3.1 官方 `next build --webpack` 完成同一生产构建，
  编译、TypeScript、23 个静态页面、page data 与 build traces 全部成功。
