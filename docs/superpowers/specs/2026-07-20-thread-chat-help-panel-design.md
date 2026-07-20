# Thread Chat 使用提示弹层设计

## 问题

顶栏 `title="使用提示"` 的按钮当前只把 `hintManual` 设为 `true`，从而将提示卡
重新插入主会话顶部。用户位于画布视图或已滚离主会话顶部时看不到该卡片，因此按钮
表现为点击无反馈。

## 交互设计

- 保留空白新对话中的首次内联提示；用户关闭或发出首条消息后，首次提示按现有规则
  消失。
- 顶栏帮助按钮不再恢复内联提示，而是打开居中的“使用提示”Dialog。
- Help Dialog 与“对话列表”和全局“会话树”使用相同的 Base UI Dialog、Portal
  挂载点、遮罩、进场/退场动画及点击遮罩关闭行为。
- Help Dialog 支持 Escape 关闭，并接入壳层现有的逐层关闭链，避免 Base UI 与
  document 监听器重复处理 Escape。
- Help Dialog 在列视图和画布视图中均可见，关闭后不改变当前视图、会话、滚动位置或
  首次提示的 dismissed 状态。

## 组件设计

新增 `app/thread-chat/orchestration/help-panel.tsx`：

- 内部的使用提示内容组件作为单一展示来源，同时供首次内联提示和 Dialog 使用，避免
  两份提示文案漂移。
- `UsageHint` 负责首次内联卡片及关闭按钮。
- `HelpPanel` 负责 Dialog 外壳，接收 `closing`、Portal `container` 和 `onClose`。

`thread-chat-demo.tsx` 负责：

- 用独立的 help panel 状态管理打开、closing 动画和延迟卸载。
- 顶栏按钮打开 Help Dialog。
- 将 Help Dialog 加入 Escape 逐层关闭链。
- 移除 `hintManual`；首次内联提示仅由 `hintDismissed` 和主会话是否已有消息决定。

样式继续使用 `.swx` Dialog 基础类，只新增 help 内容区域所需的 `.helpx` 局部样式。

## 验收

- 点击顶栏“使用提示”按钮立即显示居中 Dialog。
- Dialog 在列视图和画布视图中均可打开。
- 点击遮罩或按 Escape 可播放退场动画并关闭。
- 首次内联提示仍按原规则显示和关闭，提示文案与 Dialog 一致。
- 打开和关闭 Help Dialog 不改变会话树数据或工作台状态。
- `pnpm typecheck` 与改动文件 ESLint 检查通过。

## 非目标

- 不修改“对话列表”或“会话树”的内容和行为。
- 不增加新的快捷键。
- 不改变提示文案本身。
