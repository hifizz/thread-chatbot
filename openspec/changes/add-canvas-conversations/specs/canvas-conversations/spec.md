# canvas-conversations 画布内对话

## ADDED Requirements

### Requirement: 节点展开面板

单击画布节点 SHALL 在卡片下方展开外挂面板（绝对定位、不参与 dagre 布局——展开零重排，选中节点 zIndex 抬升盖过相邻节点）；再次单击空白或选中其他节点收起。面板 SHALL 含该会话的迷你消息列表（Markdown 富文本渲染、流式平滑、已有锚点高亮照常显示）与 mini composer；发送/停止/重试语义与列模式一致（同一 chat-controller）。双击节点回列模式的既有行为 SHALL 保留（面板内双击不误触）。

#### Scenario: 展开与流式追问

- **WHEN** 用户单击某节点、在面板 composer 输入问题回车
- **THEN** 面板消息列表内出现 user 气泡并流式渲染 assistant 回复（Markdown 结构正常），期间可停止；列视图不发生任何列位变化

#### Scenario: 零重排展开

- **WHEN** 节点面板展开/收起
- **THEN** 其余节点位置不变（不触发 dagre 重排）

### Requirement: 画布内划选开分支

面板内 assistant 消息 SHALL 复用列模式的划选 DOM 契约（`.md-body` 容器、`data-list`/`data-msg-id`），划选弹出的气泡（含 Phase A 输入框全部能力）SHALL 在画布任意 zoom/pan 下定位正确（fixed 视口坐标）。提交后 SHALL 在画布上产生新分支节点。

#### Scenario: zoom 下划选

- **WHEN** 画布缩放至非 1 倍、用户在面板消息里划选文字
- **THEN** 气泡在选区旁正确弹出；带问提交后新节点出现且首答流式

### Requirement: 手势共处

面板 SHALL 挂 React Flow 的 `nodrag`/`nowheel`：面板内选字不拖动节点、面板内滚动不缩放画布；画布空白处的 pan/zoom 手势不受影响。

#### Scenario: 面板内滚动

- **WHEN** 用户在面板消息列表内滚轮滚动
- **THEN** 列表内滚、画布 zoom 不变；在画布空白处滚轮 → 画布正常缩放

### Requirement: 画布 fork 的列槽隔离与视口跟随

在画布内开的分支 SHALL 不占用列视图槽位（回列模式时列布局与开分支前一致）；新节点出现后画布 SHALL `setCenter` 平滑跟随（偏移按 LR 布局取横向），新节点处于选中态。

#### Scenario: 列槽隔离

- **WHEN** 用户在画布内开了一个新分支后切回列视图
- **THEN** 列布局与进画布前一致（新分支不强占槽位），可经脚注/⌘K 打开
