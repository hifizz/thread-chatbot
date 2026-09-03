## Why

thread-chat 手写样式层（`app/thread-chat/styles/`，22 个区块文件）的 token 只有 primitive 层（`--paper/--ink/--d1..--d5`），排版、间距、阴影散落为裸值。经全量核实：裸 px 值 544 处（其中非偶数值 35 处，如 `12.5px/13.5px/10.5px` 字号）、color-mix 混色 46 处、hex/rgba 颜色字面量 161 处、带硬编码 fallback 的变量引用 30+ 处（`--fc/--dc/--accent` 族）、z-index 10 处裸值。此外 `tree-list.css` 同时存在与 `--d2` 同值的裸字面量 `#b07d2e`（未保存态高亮）和给 `--d1` 错挂 `--d2` 值的死 fallback（`var(--d1, #b07d2e)`），证明颜色不收口必然持续分叉。

三条不可打破的原则约束本变更：**① px 值必须是整数且尽量为偶数，无法为偶数的必须标注待查验复核；② 第一轮先把颜色全部 token 化（含 color-mix 收口），并按相近色相邻的原则重新规划颜色组织；③ z-index 必须通过语义变量控制**。

## What Changes

- **引入三层 token 模型 + 实例级 contextual 层**：primitive（`--tc-palette-*` 色板 / `--tc-font-stack-*` 字体栈）→ semantic（`--tc-{类目}-{语义角色}-{状态?}`，区块样式唯一允许引用的层）→ component（仅组件需独立覆写时建）；`--fc/--dc/--accent` 等由 TS 按实例注入的动态变量收口为 contextual 层，fallback 一律改引用 semantic token，删除死色 fallback。
- **第一轮：颜色全量 token 化**（本变更核心）：
  - 161 处 hex/rgba 字面量、30+ 处硬编码 fallback 全部收口为 token 引用；字面量一律**按同值归位**、死 fallback 一律清除（均不改变计算样式），确需改指向的疑似历史遗留（如 tlx-unsaved 是否应改指 depth-1）登记后归轨 B 决策；
  - 46 处 color-mix 按**用途**收口为派生 token（如 hover 底色、选中底色、锚点高亮、边框强调），不按混色强度机械建 token；
  - 颜色定义文件按**相近色相邻**聚类组织（paper 系 / ink 系 / depth 系 / 功能色系分节）；
  - 引用面覆盖 CSS + TS + TSX：`theme.ts`、`anchored-markdown.tsx`（动态拼接改为注入 contextual 变量、由 CSS 统一混色）、`bubble-shape.tsx`、`use-canvas-layout.ts`。
- **z-index 语义化**：10 处裸值收口为语义 token（列内局部层 / 弹层层级两族），并附 stacking context 审计结论。
- **`.tc-prose` 插件式正文排版（结构迁移 + 数值规范化）**：`markdown.css` 的排版规则及 `drawer.css`/`canvas.css` 中的 `.md-body` 排版选择器全部迁移为 `.tc-prose`；`.md-body` 仅保留「锚点定位坐标系」DOM 契约；迁移时全部非偶数字号就近取偶（`12.5→12`、`13.5→14`、`14.5→14`、`15.5→16`、`11.5→12`、`10.5→10`），亚像素排版修饰值（`letter-spacing: 0.5px`、`1.5px` 边框等）保留并标注待查验复核。
- **prose 响应式档位改用容器查询**：阅读档位由正文容器宽度（`@container`）而非视口决定，避免多列窄列套用大屏排版；`compact` 修饰符以各档位对应的离散偶数 token 与档位正交组合，避免比例缩放产生亚像素值。此部分**明确允许视觉变化**，以截图基线验收。
- **规格措辞修正**（消除矛盾）：「已纳入当前迁移范围的值必须经 semantic token 引用；未纳入范围的存量裸值允许保留，但不得新增」；主题覆盖承诺降级为「颜色替换型主题调整（品牌色、深度轴）SHALL 可仅改 tokens 基础文件完成」，深浅色主题与 JS 主题注入机制移出本变更。

## Capabilities

### New Capabilities

（无——全部落在既有 `thread-chat-styling` 能力范围内）

### Modified Capabilities

- `thread-chat-styling`：
  - 「设计 token 单一来源」升级为**三层 + contextual 模型**，并修正为按迁移范围判定违规（消除「禁止所有裸值」与分期迁移的矛盾）；
  - 新增**颜色 token 化与聚类组织**要求（字面量/fallback/color-mix 收口、相近色相邻、引用面含 TS/TSX）；
  - 新增**数值规范**要求（整数偶数原则、非偶数标注待查验复核）；
  - 新增 **z-index 语义层级**要求；
  - **`.tc-prose`** 要求修订：迁移范围扩展、容器查询档位、`.md-body` 仅保留 DOM 契约、整数化取值；
  - 「主题覆盖经由语义层」收缩为颜色替换型承诺；
  - 原有「按功能区块分文件」「级联等价（拆分对最终渲染零影响）」「`.tc` 手工作域」要求不变。

## Impact

- **代码**：`app/thread-chat/styles/` 全部 22 个文件（tokens.css 升级为 `tokens/` 分层入口，区块文件改写引用）、`app/thread-chat/thread-chat.css`、`theme.ts`、`anchored-markdown.tsx`、`bubble-shape.tsx`、`use-canvas-layout.ts`、`markdown-body.tsx`。
- **依赖**：无新增运行时或构建依赖（容器查询为浏览器原生能力，不涉 Tailwind v4 管线变更）。
- **风险**：
  - 颜色轮（重命名 + 换引用、值不变）与 prose 轮（结构迁移 + 数值取整、允许变化）验收标准不同，混用会误报回归——采用双轨验收；
  - `theme.ts` 与 `anchored-markdown.tsx` 的动态变量拼接必须同步，否则深度配色失效；
  - 非偶数字号取整带来可感知的排版微变，需逐项记录并经视觉确认。

## Future Work（移出本变更，各自成后续 Change）

- space / radius / elevation / state 类目迁移（含裸 px 的属性类别化迁移）；
- sizing / motion / focus / scrim 类目；JS 主题配置注入机制与深浅色主题；
- UI 排版 role（body/label 等字号 token）——本轮 typography 仅覆盖字体族与 prose 排版值。
