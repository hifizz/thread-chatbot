## Context

`thread-chat-demo.tsx` 当前维护 `hintDismissed` 与 `hintManual` 两个状态。手动帮助按钮仅设置 `hintManual=true`，提示仍作为 `BranchableChat` 的 `intro` 插在主会话顶部；它不是浮层，且在画布视图中根本不渲染。项目已有两种居中弹层——全局会话树和对话列表——都通过 Base UI Dialog、挂到 `.tc` 根的 Portal、`.swx` 样式及壳层统一 Escape 链实现。

## Goals / Non-Goals

**Goals:**

- 手动帮助入口在列/画布视图和任意滚动位置都能可靠显示。
- 与现有居中弹层保持相同的遮罩、动画和关闭语义。
- 首次内联提示与 Help Dialog 共用内容来源。

**Non-Goals:**

- 不改变首次提示出现条件或提示文案。
- 不改变对话列表、会话树、Artifact 抽屉及选择气泡的行为。
- 不新增快捷键、持久化字段或服务端能力。

## Decisions

### D1：新增独立 HelpPanel，而非继续回插主会话

**选择**：新增 `orchestration/help-panel.tsx`，其中 `HelpPanel` 负责 Dialog，`UsageHint` 负责首次内联卡片，两者复用同一个内部提示列表。

**理由**：手动帮助是视口级浮层，不应依赖当前视图是否渲染主会话或用户滚动位置。独立编排组件还能避免继续膨胀顶层壳文件。**弃选**：点击后切回列视图并滚到主会话顶部（改变用户上下文）；直接在壳文件内写整套 Dialog（内容与状态耦合，难以复用）。

### D2：复用现有受控 Dialog 生命周期

**选择**：Help Dialog 使用 `Dialog open={!closing}`、`dialogCloseToShell(onClose)`、挂到 `tcRootRef` 的 `DialogPortal`、`.swx-scrim` 和 `.swx.global`。壳层用 `{n, closing}` 状态与 `POPUP_EXIT_MS` 延迟卸载，和对话列表一致。

**理由**：现有模式已经解决 Portal CSS 作用域、Base UI 退场挂载和 Escape 双触发问题。另起 DialogContent 默认样式会与纸面 UI 不一致，也会绕开壳层关闭链。

### D3：首次提示状态与手动弹层状态分离

**选择**：删除 `hintManual`。首次提示可见性保持 `!hintDismissed && !mainHasMessage`；Help Dialog 使用独立状态。关闭 Help Dialog 不修改 `hintDismissed`。

**理由**：首次引导和随时帮助是两个不同生命周期。继续共用布尔状态正是当前“按钮有响应但不可见”的根因。

### D4：Help Dialog 加入统一 Escape 优先级

**选择**：Help Dialog 作为顶层模态入口放在 Escape 关闭链前部；一次 Escape 只关闭当前最外层未在退场的弹层。点击遮罩仍直接调用自己的 `onClose`。

**理由**：Base UI 的 Escape 关闭通过 `dialogCloseToShell` 取消并放行到 document；维持单一权威可避免一次按键关闭多个层级。

## Risks / Trade-offs

- **[提示 JSX 被抽离后样式失配]** → `UsageHint` 保留 `.hint` 结构；Dialog 内容使用 `.helpx` 局部类，不改通用 `.swx`。
- **[多个居中 Dialog 同时打开]** → 维持现有独立状态模型，由 Escape 关闭链一次关闭一个；本变更不扩大到统一弹层管理器。
- **[关闭动画期间重复点击]** → `{n, closing}` 的重挂模式允许 closing 中重新打开为新实例，和已有切换器行为一致。

## Migration Plan

无数据迁移。部署为纯前端变更；回滚时恢复旧的 `hintManual` 路径并删除 HelpPanel/CSS 即可。

## Open Questions

（无——已确认保留首次内联提示，手动入口改为 Dialog。）
