## Why

当前深度研究把计划、思考、搜索和网页读取逐项平铺在 assistant 消息中；一次访问数百个网页时，过程条目会淹没最终回答，同时完整工具输出随 `UIMessage.parts` 反复序列化、checkpoint、重放和持久化。系统需要把长时间研究作为独立工作单元收纳，在聊天中只保留状态摘要，并让研究过程、来源和刷新后的历史都可核对。

## What Changes

- 为 `route.mode === "research"` 的 assistant 生成建立独立、持久化的 Research Run；普通 `answer`、`fetch` 和 `search` 路径保持现状。
- 新增只追加的研究事件时间线，结构化记录初始计划、计划调整、搜索、网页读取、受限公开摘要、阶段性发现、综合和终态，不展示原始思维链。
- 新增按 Run 去重的来源目录，保存来源元数据和读取状态；完整网页正文仅供当次模型循环使用，不进入 SSE、Session replay、消息 JSON 或长期来源记录。
- Deep Research 消息只显示一张紧凑摘要卡；点击后打开独立右侧面板，通过“概览 / 活动 / 来源”查看计划、真实时间线和分页来源。
- 面板关闭只停止详情刷新，不停止研究；现有停止生成命令继续负责显式停止任务。
- 研究详情采用按事件序号增量读取，来源采用每页 25 条的 cursor 分页；刷新后从数据库恢复摘要、事件和来源。
- 新格式只在存在 Research sidecar 时启用；没有 sidecar 的历史研究消息继续使用现有内联轨迹。
- 当前功能分支只修改 Drizzle schema 并用独立本地数据库 `db:push` 验证，不生成或修改 `drizzle/` migration；正式 migration 由 `develop` 集成阶段统一生成和验证。

## Capabilities

### New Capabilities

- `deep-research-workspace`: 定义 Deep Research 的持久化 Run、事件与来源契约，聊天摘要卡、右侧研究面板、增量读取、来源分页、大内容裁剪、历史兼容和终态恢复行为。

### Modified Capabilities

<!-- No existing capability requirements change. -->

## Impact

- **Database:** `lib/db/schema.ts` 增加 `research_runs`、`research_events`、`research_sources` 及关系；本分支不生成 migration。
- **Contracts and APIs:** 增加研究摘要、事件、来源 DTO，以及按 assistant message 读取研究详情和分页来源的 owner-scoped API。
- **Streaming:** 研究工具生命周期先写入 sidecar，再发送轻量实时摘要；Deep Research 的公开工具输出移除网页正文，原始 reasoning 不进入客户端。
- **Client state:** normalized conversation store 增加 Research Run 摘要缓存和按序合并规则；详情与来源在面板打开时按需读取。
- **UI:** assistant body 在新 Research Run 存在时以单一摘要卡替代内联计划、Reasoning 和搜索轨迹；新增独立 `.tc` 作用域面板样式并复用现有右侧 drawer 几何和焦点恢复模式。
- **Compatibility:** 普通联网搜索、旧研究消息、最终正文、引用、附件和 Artifact 保持兼容；不新增第三方依赖。
