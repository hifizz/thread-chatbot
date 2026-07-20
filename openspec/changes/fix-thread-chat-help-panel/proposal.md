## Why

顶栏“使用提示”按钮当前只把提示卡重新插回主会话顶部；用户处于画布视图或已滚离顶部时看不到它，点击表现为无反馈。手动帮助入口需要改为始终可见的模态弹层，同时保留新对话首次引导。

## What Changes

- 顶栏“使用提示”按钮改为打开居中的 Help Dialog，不再恢复主会话顶部的内联提示。
- Help Dialog 复用“会话树 / 对话列表”的 Base UI Dialog、Portal、遮罩、进退场动画和 Escape 关闭链。
- 提取共用的使用提示内容，供首次内联提示和 Help Dialog 复用，避免文案漂移。
- 保留空白新对话的首次内联提示及其原有消失/关闭规则。

## Capabilities

### New Capabilities

- `thread-chat-help`: Thread Chat 首次使用提示与手动 Help Dialog 的展示、关闭和内容一致性。

### Modified Capabilities

（无）

## Impact

- **前端编排**：`app/thread-chat/thread-chat-demo.tsx` 增加 Help Dialog 状态、关闭动画和 Escape 链接线。
- **组件**：新增 `app/thread-chat/orchestration/help-panel.tsx`，承载共用提示内容和 Dialog 外壳。
- **样式**：`app/thread-chat/thread-chat.css` 增加 Help Dialog 内容区局部样式，继续复用 `.swx` 弹层基础样式。
- **不涉及**：API、数据库、会话树数据模型、工作台持久化和新增依赖。
