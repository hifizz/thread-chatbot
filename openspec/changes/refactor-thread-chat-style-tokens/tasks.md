> **执行顺序（用户指令 2026-09-02）**：先完成第一阶段改造（颜色 + z-index，**零差异**），
> 验收通过后，再单独执行第二阶段的 `.tc-prose` 适配（MessageList 与 Artifacts 的文档展示）。
> 第二阶段同样「先不要有差异」：结构迁移保持现值；非偶数取整与容器档位是显式批准后
> 才执行的视觉变更，单独登记。

## 1. 颜色轮（第一阶段 · 轨 A：计算样式等价）

- [x] 1.1 建立 `styles/tokens/` 分层：`base.css`（挂载/reset）、`palette.css`（primitive 色板 + 字体栈，按 paper 系 / ink 系 / depth 系 / 功能色系 / 白与阴影分节聚类，相近色相邻）、`surface.css`、`content.css`、`border.css`、`depth.css`、`color-derived.css`（color-mix 按用途派生）、`typography.css`、`z-index.css`；`tokens.css` 保留为按序 `@import` 的单一入口（桶文件 `thread-chat.css` 不动）
- [x] 1.2 按 design D3 映射表定义 primitive（`--tc-palette-*`/`--tc-font-stack-*`）与 semantic（`--tc-surface-*`/`--tc-content-*`/`--tc-border-*`/`--tc-depth-1..5`/`--tc-typography-family-ui/read/code`/`--tc-depth-neutral`，以及功能色 `--tc-danger`/`--tc-danger-deep` 与 `--tc-surface-plain`/`--tc-content-on-accent`）token
- [x] 1.3 按 design D5 用途聚类定义 color-mix 派生 token（hover 浅底 / 选中底 / 锚点高亮 / 锚点下划线 / on-depth 反白 / 差分行底等），建立逐项映射登记表
- [x] 1.4 替换 22 个区块文件中的颜色引用：primitive 直引、hex/rgba 字面量、`var(--fc/--dc/--accent, 死色)` fallback、color-mix 表达式全部改为 semantic/contextual token 引用（含 `tree-list.css`：字面量 `#b07d2e` 按同值归 `--tc-depth-2`、`#b03a2e` 归 `--tc-danger`、清除 `var(--d1, #b07d2e)` 死 fallback，三者均不改变计算样式；若判定 tlx-unsaved 应改指 depth-1，移入轨 B 登记）
- [x] 1.5 改造 TS/TSX 引用面：`theme.ts` 的 `dvar()`/`accentOf()` 改产 `var(--tc-depth-N)` 并收口为唯一动态拼接点；`anchored-markdown.tsx` 移除 TS 内 color-mix 拼接、改为注入 contextual 变量；`bubble-shape.tsx`（`var(--ink)`）、`use-canvas-layout.ts`（`var(--font-mono)`）改引 semantic token；`dotColorOf()` 的 `#8a8377` 收口为 `--tc-depth-neutral`
- [x] 1.6 轨 A 验收：全量 grep 清零（hex/rgba、`var(--*,#` fallback、旧 token 名 `--paper/--ink/--rule/--d/--font-ui` 等，范围 `app/thread-chat/**/*.{css,ts,tsx}`，shiki 注入色白名单豁免）；`pnpm typecheck` + `pnpm build`；构建产物 CSS 对比（除变量名外无规则级差异）；深度分色视觉抽查

## 2. z-index 轮（第一阶段 · 轨 A）

- [x] 2.1 在 `tokens/z-index.css` 定义两族层级 token：列内局部层（`--tc-z-column-under/base/raised/top` = 0/1/2/3）与弹层（`--tc-z-selection/drawer/switcher/switcher-top/toast` = 60/65/72/74/80），每枚 token 注释说明实际生效范围
- [x] 2.2 对 10 处裸 z-index（columns/messages/selection/drawer/switcher/toast）逐点收口为语义 token，并做 stacking context 审计（祖先 transform/filter/opacity 隔离情况记入注释）
- [x] 2.3 轨 A 验收：`z-index:` 数字字面量在区块文件中清零；构建产物对比无规则级差异

## 3. prose token 骨架（第一阶段 · 只建不接线）

- [x] 3.1 `tokens/prose.css` 定义 prose token：**现值原样迁入**（16/22/17/15.5/14/13.5/12.5/10.5 等），非偶数值附 `tc-review` 标注；本轮不改 `markdown.css`，`.tc-prose` 适配整体留待第二阶段

## 4. `.tc-prose` 适配（第二阶段 · 改造验收后单独执行 · 先零差异）

- [x] 4.1 `markdown.css` 的 `.tc .md-body` 规则整体迁移为 `.tc .tc-prose`（**值原样保留，零差异**，排版值改引 prose token）；`drawer.css` 的 `.tc .art-body .md-body` 与 `canvas.css` 的 `.tc .canvas-expand .md-body h1~h4` 同步迁至 `.tc-prose`；`markdown-body.tsx` 容器改为 `className="md-body tc-prose"`（TS 锚点选择器零改动）
- [x] 4.2 第二阶段结构验收：`.md-body` 排版选择器清零；零差异中间检查点随后被已批准的 4.3/4.4 视觉变更覆盖，最终以 implementation-record 中的逐项计算样式与截图结果验收
- [x] 4.3 （显式批准后）非偶数取整：35 处按 design D7 银行家舍入映射取整 + `tc-review` 标注，逐项登记视觉微变
- [x] 4.4 （已批准）容器档位：列容器/drawer 正文/canvas 面板声明 `container-type: inline-size`，`.tc-prose` 档位经 `@container` 驱动；`.tc-prose-compact` 以各档位对应的离散偶数 token 正交组合，不使用产生亚像素的比例缩放；containment 定位祖先审计（switcher 弹层/help-panel）
- [x] 4.5 第二阶段视觉验收：多列窄列（1440px 视口每列 ~420px）不套宽松档；五场景截图基线更新

## 5. 收尾验证与文档

- [x] 5.1 `pnpm openspec:validate` 通过；变更登记表（颜色映射、color-mix 用途聚类、非偶数取整、stacking 审计）归档至 change 目录
- [x] 5.2 更新 `CLAUDE.md` 中 thread-chat 手写样式段落：token 单一来源描述改为分层模型 + `tokens/` 结构 + 数值规范（整数偶数、`tc-review` 标注）
- [x] 5.3 在本 change 附 Future Work 清单（space/radius/elevation/state、sizing/motion/focus/scrim、UI 排版 role、主题注入机制与深浅色），作为后续 Change 的输入

## 6. Review 修复

- [x] 6.1 `MarkdownBody` 增加显式 `default | compact` density；Canvas 与 Artifact 通过组件契约选择 compact，删除 drawer/canvas 对 `.tc-prose` 字号和标题的专用覆盖，确保容器档位与 density 正交组合
- [x] 6.2 contextual 派生改为显式 `.tc-accent-context` / `.tc-fork-context` 边界，删除 token 层对业务组件选择器的白名单与根节点重复公式
- [x] 6.3 派生色中的白色、阴影色全部从 semantic/primitive 单一来源取值，清除未消费的 palette 基色与 `#fff`/重复 RGB 源值
- [x] 6.4 校正实施文档：区分已完成的独立验收检查点与最终提交组织，记录 review 后的 canonical 变体/上下文边界
