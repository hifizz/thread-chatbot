# Design: split-project-artifacts-drawers

## Context

现状（勘察结论，动机见 proposal.md）：

- 单抽屉 `ProjectPanel`（`art-drawer project-panel`，z-index 65，`top:0` 覆盖顶栏），
  内部 `ProjectPanelSection = "overview" | "files" | "artifacts"` 三 Tab；自定义 fixed
  div + `inert`，非 Base UI Dialog。
- 壳层 overlay 状态在 `use-workspace-overlays.ts`：`drawerOpen` boolean +
  `activeArtifactId`；Esc 走 `escapeOverlayTarget` **固定优先级链**
  （help > tree-list > selection > switcher > drawer）。
- 既有 z-index：selection 60 / drawer 65 / switcher scrim+panel 72/74 / toast 80；
  顶栏（topbar）无 z-index，被抽屉覆盖。
- 会话树/会话列表弹窗的规约：Base UI Dialog `modal={false}` +
  `disablePointerDismissal` + `dialogCloseToShell`（Esc 取消内建关闭、冒泡给壳层）；
  组件内编辑/确认态在捕获期 `stopPropagation` 消费 Esc。
- 仓库已装 `@base-ui/react` Drawer（`modal={false}`、`initialFocus/finalFocus`、
  swipe 支持齐全）。工作区已有持久化 `workspace.panelSizes.artifactDrawer`
  （`core/types.ts` / `workspace-state.ts`），sanitizer 目前只查 finite。
- Artifact 卡片 click 位于 `markdown-artifact-card.tsx`，`onClick={() => onOpen(id)}`
  丢弃事件；链：`branchable-chat → canvas-actions → thread-canvas/demo`。
- gate-3 legacy 适配器 `artifact-drawer.tsx` 仅 harness 使用；死 CSS
  `.art-tabs/.art-tab/.art-src/.historical-artifact/.art-empty`（后者有测试强制保留）。
- 依赖约束：`add-project-workspace-mvp`（43/46，未归档）的 spec 定义了被本 change
  MODIFIED 的 requirement；本 change 归档顺序必须在其之后。

## Goals / Non-Goals

**Goals:**

- 双抽屉可共存、严格单一权威层叠栈；Esc 三级模型一次只关一层。
- 抽出共用 `LayeredDrawer` 壳（侧向/过渡/inert/focus/栈索引/拖拽把手），
  Project 与 Artifacts 只填内容。
- Artifacts 紧凑纵向列表 + 渐进披露；位置感知侧向，尽量不遮挡被点卡片。
- 命名与死代码清理一次性做完，不留兼容壳。

**Non-Goals:**

- 不动 API/DB/DTO；Artifact 的分页/虚拟化（Bootstrap 全量返回，面向中等规模，
  大规模另开 change）。
- TreeList/Switcher 的 Dialog 外壳不重构（仅把它们的关系从不一致改为互斥）；
  不引入全局状态管理库。
- Artifact 编辑/删除/跨 Thread 引用（沿用 MVP 既有边界）。

## Decisions

### D1：层叠栈的唯一权威在壳层 hook，Drawer 只收 props

`use-workspace-overlays` 以 `drawerStack: DrawerId[]`（`"project" | "artifacts"`，
按打开先后入栈）取代 `drawerOpen` boolean。纯函数放 `workspace-overlay-logic.ts`
（可单测）：`openLayer(stack,id)`（已开则移至栈顶）/ `closeLayer(stack,id)` /
`topLayer(stack)` / `layerZIndex(index)`。Drawer 组件**不自行注册**，只接收
`open / zIndex / side / onActivate / onClose`。关闭动画期间由壳层保留其 z-index
（closing 项暂存栈中，动画结束定时器到期才出栈，沿用 POPUP_EXIT_MS 模式）。

备选：Drawer 自注册自注销 → 双状态源（review 已否决），弃。

配套修正：

- 顶栏提升到抽屉之上（z-index 高于抽屉栈峰值），保证两个触发器恒可达——
  用户定稿「不互斥、先后决定 z-index」依赖触发器可点。
- 同侧重叠时下层抽屉 `inert` + `aria-hidden`；`onActivate`（pointerdown）提升到栈顶。
- Help/TreeList/Switcher 改为互斥（开一关其余），消除「固定链先关 TreeList 而
  Switcher 视觉在上」的错位。
- Esc 三级：① 抽屉/弹层内态（捕获期 stopPropagation 消费：搜索词非空先清搜索、
  详情先回列表、Contract 编辑态先取消编辑）→ ② 瞬态弹层（互斥后按打开序）→
  ③ `topLayer(drawerStack)`。keydown 处理器统一忽略 `isComposing` 与 `repeat`。

### D2：先验证 Base UI Drawer，不通过才留自定义壳

`LayeredDrawer` 首选以 `@base-ui/react` Drawer 为底座（`modal={false}`、
`disablePointerDismissal`、`initialFocus={false}`、关闭动画用 data 属性驱动），
复用 D1 的栈 props。验收门（spike，半天内可判）：非模态下能否（a）自由控制
left/right 锚定与进场方向；（b）关掉 swipe 或将其限制在窄屏；（c）`finalFocus`
支持「isConnected/可见性校验 → 剩余顶层抽屉关闭钮 → 顶栏」三级回落函数。
三条任一不满足即退回：沿用 `.art-drawer` 自定义壳，手写 focus 捕获/归还按上述
三级回落实现（现状仅记录 `activeElement` + 关闭即归还，两抽屉场景会抢焦点，必须改）。

备选：原生 `<dialog>`/自研全套 → 无既有过渡状态机，工作量与风险均高，弃。

### D3：焦点与 Esc 语义对齐既有弹窗规约，tab 语义补齐

- 打开记录触发元素（仅 closed→open 边沿记录；激活提升不重复记录/抢焦）。
- 归还校验 `isConnected` 且非 inert 后方调用 `.focus()`。
- Esc 归壳层 keydown 权威（与 `dialogCloseToShell` 规约一致）；内态消费走捕获期
  stopPropagation，与 tree-list 编辑态做法同构。
- Project Drawer 的 Overview/Files 段头补全 `role="tab"`/`aria-selected`/
  `aria-controls`（现状只有 tablist）。
- 窄屏检测：`viewportW < 960px` → 单抽屉互斥 + ~94vw + 禁拖拽；常规屏幕下
  Project 与 Artifacts 默认同为 520px。该断点以常量收敛，避免中等屏幕过早进入窄屏模式。

### D4：位置感知侧向以「碰撞判定」而非裸半屏

`onOpen` 签名整条链改为 `openArtifact(id, { source: "pointer" | "keyboard" | "topbar", anchorRect?: DOMRect })`：

- `source: "pointer"`：默认侧向 = anchorRect 中心在左半屏 → right，反之 left；
  若抽屉**当前宽度**在默认侧仍会覆盖 anchorRect，则取对侧（纠正「抽屉 >50vw 后
  半屏规则失效」）。已在栈中打开的，仅 `openLayer` 提层 + 选中，**不翻边**。
- `keyboard` / `topbar`：恒 right。
- 消息卡片上的方向箭头/「打开预览 →」与 help-panel「右侧面板预览」文案按侧向
  动态化或改为方向中立表述。

备选：裸传 `clientX` 半屏判定 → 实现最简但宽抽屉下承诺破产（review 已指出），弃。

### D5：宽度状态并入既有 workspace panelSizes，不造新 key

- 拖拽把手复用列分割线的交互规约（`role="separator"`、方向键步进、双击复位、
  `setPointerCapture`、`pointercancel` 清理、`touch-action:none`、拖动时禁选文本）；
  左侧形态时位移方向取反。
- 拖动过程只更新本地态/CSS var；`pointerup`（或键盘 commit）才
  `setWorkspace({ panelSizes: {...prev, artifactDrawer: w} })` 浅合并写入；sanitizer
  增加数域校验（320 ≤ w ≤ floor(viewportW*2/3) 的持久值改为比例或 clamp 后存）。
- 复位 = 删除 `artifactDrawer` 键，恢复与 Project Drawer 相同的 520px 默认宽度。
- 宽度变化时「当前宽度」需回喂 D4 的碰撞判定。

### D6：Artifacts 渐进披露与细节

- 搜索阈值常量（默认 6），以**总数**判定；隐藏即清空 query。
- 「无匹配」与「还没有 Artifact」两种空态；详情返列表恢复 query 与滚动；
  切换 artifact 详情滚到顶。
- 行高压缩（`.dense` 修饰类）：icon 盒缩小、meta 单行 ellipsis；320px 下 meta 允许
  两行或保留完整可访问文本；icon-only 操作一律 `aria-label`。
- badge=`artifactOrder.length`，包括 0；Project 按钮去徽标。

### D7：拆分与清理的落点

- `project-panel.tsx` → `project-drawer.tsx`（Overview/Files）+ `artifacts-drawer.tsx`
  （搜索/列表/详情，迁自 482-608）+ `layered-drawer.tsx` 壳。
- `store-bound-project-panel.tsx` → 两个 store-bound 组件；**共享一次**
  `client.getProject` 刷新（提到壳层一次调用、两 drawer 各自订阅 store），避免重复
  hydrate；「定位来源」依赖 `project.rootThreadId` 的数据接线保留在 Artifacts 侧。
- 改名：`markdownCount`→`artifactCount`（新语义）、`onToggleMarkdown`→
  `onToggleProject`/`onToggleArtifacts`、`drawerOpen`→`drawerStack`。
- gate-3 harness 迁移到 store-bound 组合后删除 `artifact-drawer.tsx`；删死 CSS 及其
  保留性测试断言；`artifact-drawer-accessibility.test.mjs`（当前已失败）随重写修复。

## Risks / Trade-offs

- **[Base UI Drawer 非模态验收不通过]** → D2 有自定义壳回退路径，任务拆分时 spike
  先行，不回溯主链路。
- **[e2e 几乎都是源码正则断言，覆盖不了层叠/焦点/拖拽]** → 本 change 至少补齐纯函数
  单测（栈操作、Esc 三级、阈值计算）+ 关键 DOM 契约重写；真实浏览器契约单独立项，
  不阻塞本 change。
- **[Help/TreeList/Switcher 改互斥属既有行为变更]** → 与「弹层语义统一」为同一目标；
  在 specs 中显式写出互斥 scenario，回归点列入 tasks。
- **[与未归档 add-project-workspace-mvp 的规格依赖]** → proposal 已声明归档顺序；
  若 MVP 先归档则本 delta 直接可应用。
- **[同侧重叠时下层内容不可见被部分用户视为遮挡]** → 接受（用户明确「不互斥、
  先后定 z」）；以「点击/按钮提升」+「窄屏互斥」两端兜底可操作性。
- **[anchorRect 穿过多层 props 增加链签名改动面]** → 一处类型
  `OpenArtifactOptions` 收敛，五处文件机械改名，e2e 契约同步重写。

## Migration Plan

1. 纯函数层 + 壳层 hook（栈、Esc 三级、互斥）先行，单测绿。
2. D2 spike → 定壳底座；落 `LayeredDrawer`。
3. `ProjectDrawer` 迁移（Overview/Files），顶栏按钮拆出 Project，旧面板行为等价。
4. `ArtifactsDrawer` 迁移 + 紧凑/渐进披露 + badge；链签名与侧向。
5. 清理（改名/legacy adapter/死 CSS/help 文案）+ harness 迁移。
6. 测试重写与补齐；`openspec validate`；归档（须在 add-project-workspace-mvp 之后）。
   回滚：纯前端无数据迁移，整体 revert 即回旧单面板。

## Open Questions

- D2 的 Base UI Drawer 验收结果（spike 输出，决定壳底座实现路径）。
- 真实浏览器端到端（Playwright 类）契约的落地范围，随本 change 实现期另行评估。
