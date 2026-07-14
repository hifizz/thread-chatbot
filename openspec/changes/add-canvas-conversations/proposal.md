# 画布 Phase 2：节点内继续对话 + 画布内划选开分支

## Why

画布目前是只读地图（Phase 1 + LR 横向）：看得见全树、双击才能回列继续。要把画布变成**工作台**——在节点里直接读最近消息、继续追问、甚至划选开新分支，不来回切视图。参考分支（playground `claude/thread-chat-upgrade-research-joe0d6` commit 54b5a89，净增 ~200 行产品代码 + 145 行测试）已把三大难题踩平：React Flow 手势与选字共处（nodrag/nowheel）、划选气泡在 zoom 变换下的定位（fixed 天然免疫）、节点展开零重排（外挂面板不参与 dagre 布局）。本变更按我们的架构（MarkdownBody/SmoothText/text-anchor/chat-controller/LR 布局）落地。

## What Changes

- **单击节点展开外挂面板**（绝对定位挂在卡下、不参与 dagre 布局、选中节点抬 zIndex）：迷你消息列表（沿用 MarkdownBody 富文本 + SmoothText 流式 + 锚点高亮）+ mini composer（走 `chat.send`，busy/停止/重试语义同列模式）。
- **画布内划选开分支**：面板消息复用列模式的划选 DOM 契约（`.md-body`/`data-list`/`data-msg-id`），document 级划选气泡（含 Phase A 输入框）在画布原样生效；手势共处：面板 `nodrag nowheel`，双击 stopPropagation 不误触回列。
- **画布 fork 不占列槽**：画布里开的分支不挤列视图的槽位；新节点经 dagre 重排出现，`focusNode` + `setCenter` 视口跟随（偏移按 LR 横向调整）。
- 范围**不含**：画布 Phase 3（Artifact 一等节点/混合内容节点——阻塞于 threadChat 模式尚未挂工具、真实链路不产 Artifact，见 design）、画布内轻对话形态（参考分支结论：气泡锚定在缩放变换下不成立）、移动端 bottom sheet（后续独立变更）。

## Capabilities

### New Capabilities

- `canvas-conversations`: 画布节点的展开面板（消息列表/composer/流式）、画布内划选开分支、手势共处契约、视口跟随与列槽隔离。

### Modified Capabilities

（无——纯增量交互面。）

## Impact

- `app/thread-chat/orchestration/canvas-node.tsx`（外挂面板 CanvasExpand，~120–160 行）
- `app/thread-chat/orchestration/thread-canvas.tsx`（ActionsContext + focusNode/setCenter，~40 行）
- `app/thread-chat/thread-chat-demo.tsx`（画布分叉的 handleFork 不走 cols.openThread + focusNode 状态，~30 行）
- `app/thread-chat/thread-chat.css`（面板样式，~40 行）
- `e2e/thread-chat/verify-canvas-chat.mjs`（新入库脚本，断言面参考 playground verify10）
- **不改**：schema/持久化（消息本在树里，focusNode/selected 是视口态不入档）、text-anchor、服务端。
