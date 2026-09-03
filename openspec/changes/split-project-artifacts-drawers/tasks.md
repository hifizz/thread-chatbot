# Tasks: split-project-artifacts-drawers

## 1. 纯函数层与壳层状态（先行，单测驱动）

- [x] 1.1 `workspace-overlay-logic.ts` 新增栈纯函数：`openLayer`（已开移栈顶）/ `closeLayer` / `topLayer` / `layerZIndex`；补单测
- [x] 1.2 Esc 三级解析函数（内态 → 瞬态弹层 → 抽屉栈顶）替代 `escapeOverlayTarget` 的固定链；忽略 `isComposing`/`repeat`；补单测
- [x] 1.3 窄屏降级阈值函数（两抽屉最小宽 + 正文保留宽 → boolean），常量集中到 `constants/`；补单测
- [x] 1.4 `use-workspace-overlays.ts`：`drawerOpen` → `drawerStack: DrawerId[]`，含 closing 暂存项（动画期间保留 z-index，到期出栈）

## 2. 壳底座 spike（D2 验收门）

- [x] 2.1 验证 Base UI Drawer 非模态形态：左右锚定/进场方向、swipe 限定、`initialFocus/finalFocus` 与三级焦点回落的可行性；输出结论
- [x] 2.2 根据 spike 结论实现 `layered-drawer.tsx`：`open/zIndex/side/onActivate/onClose` props、进出场过渡、`inert`/`aria-hidden`、焦点捕获与三级归还
- [x] 2.3 `LayeredDrawer` 的拖拽把手：`role="separator"`、方向键步进、双击复位、`setPointerCapture`、`pointercancel`、`touch-action:none`、左侧镜向位移

## 3. ProjectDrawer 迁移

- [x] 3.1 `project-panel.tsx` 拆出 `project-drawer.tsx`：仅 Overview/Files 两段，tab 语义补齐（`role="tab"`/`aria-selected`/`aria-controls`）
- [x] 3.2 Overview 编辑态 Esc 捕获期消费（取消编辑、不冒泡关抽屉）
- [x] 3.3 `store-bound-project-panel.tsx` 拆出 `store-bound-project-drawer.tsx`；`getProject` 刷新提升到壳层一次调用

## 4. ArtifactsDrawer 迁移与紧凑浏览

- [x] 4.1 `artifacts-drawer.tsx`：搜索/列表/详情迁自 project-panel 482-608；`store-bound-artifacts-drawer.tsx`（保留 `rootThreadId` 定位接线）
- [x] 4.2 渐进披露：搜索阈值（默认 6，按总数判定）、隐藏清空 query、「无匹配」空态、详情返回恢复 query/滚动、切换详情滚顶
- [x] 4.3 `.dense` 密度变体 + 320px 下 meta 可读性 + icon-only 按钮 `aria-label`
- [x] 4.4 Artifacts 详情态/搜索态 Esc 捕获期消费（详情→列表、清空搜索，再冒泡）

## 5. 侧向与位置感知

- [x] 5.1 龙一签名 `openArtifact(id, { source, anchorRect? })` 贯穿 `markdown-artifact-card` → `branchable-chat` → `canvas-actions` → `thread-canvas`/`canvas-expand` → demo
- [x] 5.2 侧向决策：半屏默认 + 当前宽度碰撞判定取对侧；keyboard/topbar 恒右；已开仅提层选中不翻边
- [x] 5.3 `drawer.css` `.left` 形态镜像（`left:0; right:auto`、transform/阴影/把手位置）+ `topbar.css` 层级提升
- [x] 5.4 卡片箭头/「打开预览 →」与 `help-panel.tsx` 文案改为侧向中立表述

## 6. 顶栏双入口

- [x] 6.1 `thread-chat-topbar.tsx`：拆 `Project`/`Artifacts` 两按钮；去掉 Project 徽标；`artifactCount` = `artifactOrder.length`，包括 0
- [x] 6.2 改名落地：`onToggleMarkdown`→`onToggleProject`/`onToggleArtifacts`、调用点同步

## 7. 宽度持久化

- [x] 7.1 `panelSizes.artifactDrawer` 写入路径：pointerup/键盘 commit 才 `setWorkspace` 浅合并；复位删覆盖键
- [x] 7.2 `workspace-state.ts` sanitizer 增加数值域校验（clamp 或丢弃非法值）
- [x] 7.3 窄屏模式禁拖拽、~94vw 呈现、退出窄屏恢复侧向与宽度

## 8. 瞬态弹层一致性与层级修正

- [x] 8.1 Help/TreeList/Switcher 打开互斥（开一关其余）
- [x] 8.2 selection bubble 视觉层级与 Esc 优先级对齐（z-index 高于 drawer 或调整三级顺序）

## 9. 清理

- [x] 9.1 gate-3 harness 迁移到 store-bound 组合；删除 `artifact-drawer.tsx` legacy 适配器
- [x] 9.2 删除死 CSS（`.art-tabs/.art-tab/.art-src/.historical-artifact/.art-empty`）及强制保留死样式的断言

## 10. 测试与验收

- [x] 10.1 `project-panel-ui-contract.test.mjs` 重写为双抽屉 DOM 契约
- [x] 10.2 修复并重写 `artifact-drawer-accessibility.test.mjs`（当前已失败：断言错位到 project-panel）
- [x] 10.3 更新受波及断言测试：`workspace-overlay` / `thread-chat-topbar` / `message-artifacts` / `artifact-drawer-copy` / `artifact-drawer-css` / `project-panel-workspace-state` / `normalized-client-store`
- [x] 10.4 手动验收清单：双开层叠与提升、Esc 逐层、focus 归还三回落、拖拽持久化与复位、位置感知侧向、窄屏降级
- [x] 10.5 `openspec validate split-project-artifacts-drawers --strict` 通过

## 11. 宽度默认值与窄屏断点调整

- [x] 11.1 Artifacts Drawer 无持久化覆盖时默认宽度改为与 Project Drawer 相同的 520px，保留拖拽与历史宽度
- [x] 11.2 窄屏切换断点改为 960px，并补 959/960px 边界测试
- [x] 11.3 更新宽度相关回归测试并通过 typecheck、lint 与 OpenSpec strict validate
