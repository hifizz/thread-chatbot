# Proposal: split-project-artifacts-drawers

## Why

当前右上角只有一个 Project 按钮，打开单个 ProjectPanel 抽屉、内部以
Overview / Files / Artifacts 三个 Tab 承载全部内容。随着 Project 收敛的 Artifact
增多，「工程配置（Contract/Files）」与「成果浏览（Artifacts）」混在一个面板里
互相挤占空间：看文档时摆脱不掉 Tab  chrome，编辑 Contract 时也无法参照
Artifact。拆成两个可共存的独立 Drawer，让两条动线各占其位、互不干扰，并让
Artifacts 以节省空间的紧凑形态展示文档。

## What Changes

- **顶栏双按钮（BREAKING UI）**：`Project` 与 `Artifacts` 两个按钮。Project 按钮去掉
  badge；Artifacts badge 改为整个 Project 的持久化 Artifact 总数（store
  `artifactOrder.length`），包括 0。原 `markdownCount`（只数 active path 上
  的 markdown artifact）语义废弃。
- **ProjectPanel 拆分**：Overview + Files 留在 `ProjectDrawer`；Artifacts 区块
  （搜索 + 列表 + 详情钻取）迁入独立 `ArtifactsDrawer`。
- **两抽屉可共存，不互斥**：打开先后顺序决定 z-index（后开者在上）；点击下层抽屉
  或其顶栏按钮将其提升到栈顶；同侧重叠时仅顶层可交互（下层 inert）；视口宽度不足
  时降级为单抽屉互斥、约 94vw 呈现。
- **ArtifactsDrawer 宽度可调**：默认与 Project Drawer 同为 520px，拖拽内缘可在
  320px 至最大 66vw 间调整，pointerup 时持久化到既有
  `workspace.panelSizes.artifactDrawer`；双击把手（及键盘复位）恢复 520px 默认值并清除
  覆盖值。仅在视口小于 960px 的窄屏模式下改为约 94vw 且禁用拖拽。
- **点击位置感知侧向**：从 Thread 内 ArtifactCard 打开时按点击位置选择抽屉侧向
  （点在左半屏 → 抽屉开右侧；点在右半屏 → 开左侧），尽量不遮挡正在阅读的卡片；
  键盘激活无坐标时回退右侧；顶栏按钮打开恒为右侧。ProjectDrawer 恒右。
- **Artifacts 列表渐进披露**：恒为纵向紧凑列表 + 抽屉内详情钻取；总数 < 6 时隐藏
  搜索框与冗余 heading，≥ 6 时显示搜索；meta 单行截断，无搜索结果与空列表分态。
- **Overlay/Esc 体系收敛**：抽出 Drawer 层叠栈（open/close/activate，后进先出）；
  Esc 三级模型——抽屉内态（搜索/详情/编辑草稿）→ 瞬态弹层（Help/TreeList/Switcher
  改为互斥）→ Drawer 栈顶；修复 selection bubble（z-60）视觉层级低于 drawer（z-65）
  却被 Esc 优先关闭的既有错位。
- **规格改写（BREAKING 规格语义）**：改写 add-project-workspace-mvp 中
  "Unified Project Panel" 与 "Open an Artifact from a message card" 两条要求——
  不再禁止两个竞争抽屉，而是以层叠栈统一定义它们的行为。
- **命名清理**：`markdownCount`/`onToggleMarkdown`/`drawerOpen` 改名或重定义；
  gate-3 legacy 适配器 `artifact-drawer.tsx` 随 harness 迁移后删除；删除死 CSS
  （`.art-tabs`/`.art-tab`/`.art-src`/`.historical-artifact`/`.art-empty`）及其
  强制保留死样式的测试断言。
- **测试更新**：重写 `project-panel-ui-contract.test.mjs` 为双抽屉契约；修复当前已
  失败的 `artifact-drawer-accessibility.test.mjs`；更新受波及的其他断言型测试
  （topbar、workspace-overlay、message-artifacts、drawer-copy、drawer-css、
  workspace-state、normalized-client-store）。

## Capabilities

### New Capabilities

- `workspace-drawers`: ThreadChat 工作区的层叠抽屉基础设施——侧锚定非模态抽屉壳、
  打开顺序层叠栈（z-index/激活/提升）、Esc 分层模型、焦点捕获与归还、左右侧形态、
  拖拽调宽与持久化、窄屏降级。Project 与 Artifacts 抽屉共用此能力，后续工作区扩展
  （如更多面板）复用同一壳。

### Modified Capabilities

- `project-workspace`: 改写 "Unified Project Panel"——单面板三 Tab 改为
  Project Drawer（Overview/Files）与独立 Artifacts Drawer（基于 workspace-drawers
  能力共存）；改写 "Open an Artifact from a message card"——打开独立 Artifacts
  Drawer 并按点击位置选侧，删除「不维护两个竞争抽屉」的限制并代以层叠栈语义；
  补充 Artifacts 紧凑浏览（渐进披露/搜索分态/详情钻取）与 badge 语义要求。

## Impact

- **UI 组件**：`thread-chat-topbar.tsx`（双按钮）、`project-panel.tsx`（拆分）、
  新增 `layered-drawer.tsx` 壳与 `artifacts-drawer.tsx`、
  `store-bound-project-panel.tsx` 拆分、gate-3 harness 迁移。
- **Overlay 状态**：`use-workspace-overlays.ts`（层叠栈替代 drawerOpen boolean）、
  `workspace-overlay-logic.ts`（纯函数栈操作 + Esc 三级）。
- **点击链签名**：`message-artifacts.tsx` / `markdown-artifact-card.tsx` /
  `branchable-chat.tsx` / `canvas-actions.ts` / `thread-canvas.tsx` /
  `canvas-expand.tsx` 的 `onOpen` 由 `(id)` 变为 `(id, { source, preferredSide? })`。
- **持久化**：`core/types.ts` / `core/store.ts` /
  `net/persistence/workspace-state.ts`（panelSizes.artifactDrawer 的校验与合入）。
- **样式**：`drawer.css`（左右侧形态、dense 变体、拖拽把手、死 CSS 删除）、
  `topbar.css`（层级），常量收敛（z-index 基值/搜索阈值/宽度限）。
- **文案**：`help-panel.tsx`「右侧面板预览」表述、artifact 卡片的方向箭头。
- **OpenSpec**：与 `add-project-workspace-mvp`（43/46，未归档）存在规格依赖——
  本 change 的 delta 以 `project-workspace` capability 为目标，归档顺序须在其之后。
- **测试**：8+ 个 e2e/断言测试文件更新；建议新增真实浏览器契约（双抽屉层叠顺序、
  Esc 逐层、拖拽持久化、窄屏降级、焦点归还）。
- **无 API/DB 变更**：仅前端工作区壳层与组件改造。
