# 设计：画布 Phase 2（节点内对话 + 画布内划选）

## Context

- 我们画布现状：Phase 1 只读 + LR 横向（dagre `rankdir:"LR"`、Handle Left/Right）+ 双击回列。`thread-canvas.tsx` 137 行 / `canvas-node.tsx` 71 行。
- 参考实现：playground 分支 commit 54b5a89（TB 布局时代），三大难题已踩平并有 verify10 验收：外挂面板零重排、划选气泡 fixed 免疫 zoom、nodrag/nowheel 手势共处。已知坑（其 commit/注释明说）：Handle 只能 opacity 隐藏不能 display:none（破坏边坐标）；画布不做轻对话形态（气泡锚定在缩放变换下不成立）。
- 我们的三件套交叉点（调研结论）:text-anchor 的 `describeRange` 在 `.md-body` 上工作、文字选区与 `getBoundingClientRect` 都是视口坐标，zoom 下理论安全（需实测）；SmoothText 在面板内会引起高度变化，需贴底跟滚；持久化零改动（消息本在树里）。

## Goals / Non-Goals

**Goals:**

- 画布从地图变工作台：节点内读最近消息、追问、划选开分支。
- 列视图与画布的槽位互不干扰；视口平滑跟随新节点。
- 划选/锚点/流式/持久化全部复用既有件，零平行实现。

**Non-Goals:**

- Phase 3（Artifact 一等节点/图片等混合节点）：**阻塞于前提不存在**——threadChat 模式未挂工具、真实链路不产 Artifact（CLAUDE.md 明确该模式不挂 getWeather/compareTable），做了只能演示种子数据。等 threadChat 接工具后单独立项。
- 画布内轻对话（Phase B 形态）：参考分支已证伪（缩放下气泡锚定不成立），画布内带问提交直接长成新节点。
- 移动端 bottom sheet：独立变更，依赖本变更先落地。

## Decisions

### D1：外挂面板不参与布局（照抄参考的结构决策）

`CanvasExpand` 绝对定位挂在节点卡下方，不改 dagre 输入 → 展开/收起零重排；选中节点 zIndex 抬升。**LR 适配**：TB 树的卡下方是空白、LR 树的卡下方是兄弟节点——保持「下方展开 + zIndex 盖住」（参考已验证遮盖可用性）。〔实施修订〕`setCenter` 偏移实际为**横向 +120 与纵向 +140 并用**：横向沿 LR 主轴给右侧后续子分支留视野，纵向分量防止展开面板探出视口下沿（e2e 以「新节点整卡在视口内」实证）——设计原文「纵向改横向」的单轴表述不准确，以此为准。**弃选**：面板改挂卡右侧（LR 主轴方向会与子节点重叠更严重，且宽度失控）。

### D2：面板消息渲染 = 复用列模式全套（MarkdownBody + SmoothText + 锚点契约）

面板消息列表直接渲染 `AnchoredMarkdown` 同款（`.md-body` + 锚点 effect）或轻包装,并挂列模式的划选 DOM 契约（`.msg-list[data-list]`/`.message[data-msg-id]`/`.bubble[data-role]`）——document 级划选气泡与 text-anchor **零改动**在画布生效。参考版是纯文本,我们必须富文本,否则划选反查（以 `.md-body` 为容器）直接失效。流式期间面板列表贴底跟滚（参考 L65–68 同款逻辑）。

### D3：发送链路 = 同一 chat-controller,经 Context 注入

`CanvasActionsContext` 提供 `send/abort/retry`（壳层把 chat-controller 包进去）,面板 composer 直接调用。busy 派生同列模式（末条 assistant status）。**弃选**：给画布单独造发送通道（平行实现,违背复用纪律）。

### D4：画布 fork 不占列槽 + focusNode 跟随

壳层 `handleFork` 增加来源分支：气泡提交发生在画布模式时,fork 后**不调 `cols.openThread`**,置 `focusNode: {id, n}`（n 递增去重）;`thread-canvas` effect 里 `selectNode + setCenter(动画 ~320ms)`。回列模式时新分支不在槽位里,经脚注/⌘K 打开——与「画布是纵览、列是深读」的心智一致。

### D5：手势共处契约

面板根元素挂 `nodrag nowheel`（RF 类约定）;面板内 `onDoubleClick` stopPropagation（不触发节点双击回列）;Handle 保持 opacity 隐藏（不能 display:none,参考坑）。

## Risks / Trade-offs

- **[zoom≠1 下划选/气泡定位]** → 理论安全（选区与 rect 均视口坐标）,e2e 专设 zoom 0.75/1.5 两档断言;若实测偏移,兜底方案是气泡定位改读 selection rect（已是）+ clamp。
- **[SmoothText 高度抖动]** → 面板列表贴底跟滚 + 高度上限内滚（clamp ~360px）。
- **[RF memo 节点每帧重渲]** → 消息随 version 进 node data 会让流式期间该节点每帧重渲——chat-controller 已 rAF 合帧,单节点重渲成本可接受（参考同构且流畅）;若卡,面板内消息改直接订阅 store（绕过 node data）。
- **[LR 下面板遮挡兄弟节点]** → zIndex 抬升 + 面板半透明纸面底色;实测不适再评估「展开时对该列 rank 做局部让位」（复杂,先不做）。

## 实施偏差备注

- 面板内点击既有锚点高亮/脚注（设计未明确）：实现为画布内聚焦对应分支节点（selectNode + setCenter），贴合「画布是纵览、列是深读」心智，不打断画布工作流。
- 划选气泡在画布内按住 ⌘ 时提示行仍显示「保留本列」列语义文案——画布提交路径忽略该 hint、行为正确，仅文案与画布语境略不匹配，留待文案微调。

## Migration Plan

纯前端增量;回滚 = revert。e2e 新增 verify-canvas-chat.mjs,断言面参考 verify10 + zoom 两档 + LR 特有（跟随偏移横向）。

## Open Questions

（无——Phase 3 与移动端已明确划出。）
