## 1. 提示组件

- [ ] 1.1 新增 `orchestration/help-panel.tsx`，抽取单一使用提示内容，并提供保留现有结构/关闭行为的 `UsageHint`
- [ ] 1.2 在同一模块实现 `HelpPanel`：复用受控 Base UI Dialog、`.tc` Portal、`.swx` 遮罩/面板和 `dialogCloseToShell`

## 2. 壳层接线

- [ ] 2.1 `thread-chat-demo.tsx` 移除 `hintManual`，首次提示恢复为仅由 `hintDismissed` 与 `mainHasMessage` 派生，并改用 `UsageHint`
- [ ] 2.2 增加 Help Dialog 的 `{n, closing}` 状态、`POPUP_EXIT_MS` 延迟卸载、顶栏打开动作与组件挂载
- [ ] 2.3 将 Help Dialog 纳入统一 Escape 逐层关闭链，保证一次 Escape 只关闭一个最外层弹层

## 3. 样式与验收

- [ ] 3.1 在 `thread-chat.css` 增加 `.helpx` 内容区样式，复用 `.swx` 基础视觉并保证长内容可滚动
- [ ] 3.2 运行 `pnpm typecheck` 与改动文件 ESLint；检查魔法字符串及重复提示内容
- [ ] 3.3 在列视图和画布视图手动验证：按钮打开、内容一致、遮罩关闭、Escape 关闭、首次内联提示规则不变
- [ ] 3.4 运行 `pnpm openspec:validate` 严格校验并完成任务勾选
