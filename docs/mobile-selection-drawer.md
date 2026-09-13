# 移动端划选与提问抽屉

## 已确认范围

- 手机划选完成后，底部显示「本对话继续」「此处提问」。桌面保持原工具条与气泡。
- 使用现有 `components/ui/drawer.tsx`（Base UI Drawer），不引入 Sheet、Vaul，不改全局 Drawer API。
- 引用仍使用 `SelectionInfo` 中的消息 ID、文本锚点和原文；沿用当前引用请求及开分支回调，不改数据库或接口。
- 提问抽屉收起时保留问题和原始引用；提交沿用现有开分支规则。

## 代码检查

当前 `use-assistant-text-selection.ts` 只通过 `mousedown` / `mouseup` 获取选区，未监听手机原生长按和选区手柄触发的 `selectionchange`。

## 实现边界

- 选区 hook 仍是唯一的文档选区观察器。手机监听 `selectionchange`，短暂等待选区稳定后读取；保留原有单消息、已完成 assistant 正文校验。
- 工具条增加移动布局，固定在安全区上方，不影响消息排版，不屏蔽原生复制菜单。
- 手机提问 UI 独立组件，引用摘要可展开，输入字号至少 16px，复用 Drawer 的焦点和滑动关闭行为。
- 选区进入提问后锁定，空选区、键盘弹出和抽屉内选字不得清除引用。关闭抽屉不清空问题。
- 抽屉跟随可见视口调整高度和底部位置；内容区可滚动，按钮保留在底部。

## 验收

1. 手机长按正文、拖动选区手柄后，底部出现两个可点击按钮。
2. 当前对话引用插入正确，不覆盖已有正文，焦点回到输入框。
3. 此处提问打开底部 Drawer，清除浏览器选区后原文仍在。
4. 输入问题、收起、再次打开，问题与引用不变；回车仅换行。
5. 点击提交后开分支回调得到正确原文、消息 ID、锚点和问题。
6. 非 assistant、生成中、跨消息、空选区不得显示工具条。
7. 桌面工具条定位、气泡、草稿保护和提交行为不变。
8. iOS Safari / Chrome 真机复测原生选区手柄、系统菜单、软键盘及下拉关闭；浏览器模拟不能替代此项。

## 验证记录

- 基线：main `f7669d9fc3a6bd2e84e8ad9309c444a40a9e481d`。
- `pnpm typecheck`、改动 TS/TSX 的 ESLint 检查通过。
- `mobile-selection-observer.test.mjs` 通过：稳定采集、最终引用快照、合成鼠标事件去重、空选区、无效消息、跨消息、草稿保护、收起后引用保留、桌面鼠标事件、监听清理。
- 既有 selection observer / CSS / placement-map ownership 三项测试通过。
- 既有 `selection-composer-dimensions.test.mjs` 失败：测试仍要求 `Math.min(ta.scrollHeight, ...)`，main 原码已经使用 `ta.scrollHeight + borderY`。本次没有修改该高度逻辑，也未改旧断言来掩盖失败。
- 开发服务器启动成功；云浏览器访问 localhost 返回 `net::ERR_BLOCKED_BY_CLIENT`，未进行绕过。因此未完成可视验收或 iOS 真机验收，不能标为完整端到端通过。
- 组件接入依据现有 Base UI Drawer 与官方 https://ui.shadcn.com/docs/components/base/drawer；没有更新依赖或全局 Drawer 实现。

草稿行为：收起后仍有问题时，「本对话继续」禁用，以免静默丢弃问题；可再次进入抽屉继续编辑，清空问题后恢复当前对话引用操作。
