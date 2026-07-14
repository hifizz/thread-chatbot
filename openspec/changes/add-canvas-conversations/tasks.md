# 任务拆解：画布 Phase 2

## 1. 面板骨架

- [x] 1.1 `canvas-node.tsx` 新增 CanvasExpand 外挂面板（绝对定位卡下、选中态展开、zIndex 抬升、`nodrag nowheel`、双击 stopPropagation）；Handle 保持 opacity 隐藏
- [x] 1.2 面板消息列表：复用 MarkdownBody + SmoothText + 锚点渲染（挂列模式划选 DOM 契约 `.msg-list[data-list]`/`data-msg-id`/`.bubble[data-role]`），高度 clamp 内滚 + 流式贴底跟滚
- [x] 1.3 mini composer：经 CanvasActionsContext 调 chat.send/abort/retry，busy/停止/IME 语义同列模式

## 2. 壳层与视口

- [x] 2.1 `thread-canvas.tsx`：CanvasActionsContext 注入 + `focusNode:{id,n}` effect（selectNode + setCenter 平滑跟随，偏移按 LR 横向）
- [x] 2.2 `thread-chat-demo.tsx`：画布模式下的 handleFork 分叉——fork 后不走 cols.openThread、置 focusNode；列模式路径零改动
- [x] 2.3 CSS：面板纸面样式 + mini composer + 遮挡兄弟节点的视觉处理

## 3. 验收（真实执行，全绿才算完）

- [x] 3.1 `pnpm typecheck` 0 错；`npx eslint app/thread-chat` 0 报
- [x] 3.2 新入库脚本 `e2e/thread-chat/verify-canvas-chat.mjs`：单击展开（零重排断言：其余节点坐标不变）→ 面板内追问真实流式（Markdown 结构断言）→ 面板内滚动不缩放画布、空白处滚轮正常缩放 → zoom 0.75 与 1.5 两档下面板内划选气泡定位正确 → 带问提交长出新节点 + setCenter 跟随 + 新节点选中 → 切回列视图列布局未变（槽位隔离）→ 双击节点回列不被面板误触
- [x] 3.3 既有 e2e 回归：verify-live / verify-persist / verify-tree-list / verify-bubble-composer 全 PASS
- [x] 3.4 `pnpm build` 通过

## 4. 文档收尾

- [x] 4.1 e2e README 补一段；`pnpm openspec:validate` 通过
