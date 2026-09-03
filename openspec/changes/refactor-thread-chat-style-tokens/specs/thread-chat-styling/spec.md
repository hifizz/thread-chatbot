## ADDED Requirements

### Requirement: 颜色 token 化与聚类组织

thread-chat 样式层（`app/thread-chat/**/*.{css,ts,tsx}`）中的颜色 SHALL 全部经由 semantic token 引用：hex/rgba 颜色字面量、带硬编码 fallback 的变量引用（如 `var(--fc, #8a8377)`）、以及 color-mix 混色表达式 SHALL NOT 出现在 token 定义文件之外。字面量迁移 SHALL 按**同值归位**（如 `#b07d2e` 与 `--d2` 同值则归 `--tc-depth-2`）、死 fallback SHALL 清除，两者 SHALL NOT 改变计算样式；判定为「应改指向」的修复属视觉变化，SHALL 单独登记并移入允许视觉变化的验收轨。color-mix 派生色 SHALL 按**用途**收口为派生 token（如 hover 底色、选中底色、锚点高亮、边框强调），SHALL NOT 按混色强度机械建立 `-{n}%` 型 token；由 TS 按实例注入的动态颜色变量（`--fc/--dc/--accent` 族）SHALL 收口为 contextual 层，其 fallback SHALL 引用 semantic token 而非死色。颜色 token 定义 SHALL 按**相近色相邻**原则聚类组织（paper 系 / ink 系 / depth 系 / 功能色系分节相邻摆放），便于整体审校与主题调整。

#### Scenario: 颜色字面量清零

- **WHEN** 对 `app/thread-chat/**` 全量扫描 hex/rgba 字面量与硬编码 fallback
- **THEN** 除 `tokens/` 定义文件外零命中（shiki 主题色等第三方注入值除外）

#### Scenario: color-mix 按用途收口

- **WHEN** 区块文件需要「深度色 12% 高亮底」类混色
- **THEN** 引用按用途命名的派生 token（如选中底色、锚点高亮），文件内不直接书写 color-mix 表达式

#### Scenario: 字面量与死 fallback 归位

- **WHEN** 迁移 `tree-list.css` 的裸字面量 `#b07d2e`（与 `--d2` 同值）与死 fallback `var(--d1, #b07d2e)`
- **THEN** 字面量归位为 `--tc-depth-2` 引用、fallback 清除为 `var(--tc-depth-1)`，两者计算样式均不变（fallback 仅在变量未定义时生效）；若判定未保存态应改指 depth-1（金→青），属视觉变化，登记后移入允许视觉变化的验收轨

### Requirement: 数值规范（整数偶数与待查验标注）

新增或迁移产生的 token 值与样式声明中，px 数值 SHALL 为整数且 SHALL 尽量为偶数。迁移时遇到的非偶数字号（如 `12.5px`、`13.5px`、`10.5px`）SHALL 就近取偶（`12.5→12`、`13.5→14`、`14.5→14`、`15.5→16`、`11.5→12`、`10.5→10`），并记录预期视觉变化。确有理由无法取偶的亚像素值（如 `letter-spacing: 0.5px`、`1.5px` 边框、负 margin 热区几何）SHALL 保留原值并在行内以统一格式注释标注待查验复核（`/* tc-review: 非偶数值，保留原因 */`）。

#### Scenario: 非偶数字号取偶

- **WHEN** 迁移 `font-size: 12.5px` 到语义排版 token
- **THEN** token 值为整数偶数（12px），并在变更记录中登记该处排版微变

#### Scenario: 亚像素值标注复核

- **WHEN** 迁移中遇到 `letter-spacing: 0.5px` 等无法取偶的值
- **THEN** 保留原值并附 `tc-review` 注释，后续可按标注逐项复查

### Requirement: z-index 语义层级

thread-chat 样式中的 z-index SHALL 一律通过语义 token 引用（如列内局部层、划选层、抽屉、切换器弹层、toast 等层级角色），SHALL NOT 出现裸 z-index 数值。层级 token SHALL 附 stacking context 审计结论：若目标元素处于被 transform/filter/opacity 隔离的局部层叠上下文中，SHALL 在 token 或使用处注释说明实际生效范围。

#### Scenario: 裸 z-index 清零

- **WHEN** 对 `app/thread-chat/styles/` 全量扫描 `z-index:` 声明
- **THEN** 全部为 `var(--tc-z-*)` 形式的语义引用，无数字字面量

## MODIFIED Requirements

### Requirement: 设计 token 单一来源

thread-chat 的设计 token SHALL 采用分层模型定义在 `app/thread-chat/styles/tokens/` 目录中：

- **primitive 层**（纯值：`--tc-palette-*` 色板、`--tc-font-stack-*` 字体栈等，不代表用途）SHALL 仅被 semantic 层引用；
- **semantic 层**（语义角色，统一命名 `--tc-{类目}-{语义角色}-{状态?}`，如 `--tc-surface-base`、`--tc-typography-family-ui`）是区块样式与组件**唯一允许引用**的层；
- **component 层**（`--tc-composer-*`）仅当单个组件需要独立覆写语义值时才允许创建；
- **contextual 层**（如 `--fc/--dc/--accent` 的收口形态）由 TS 按实例注入，fallback SHALL 引用 semantic 层；派生公式 SHALL 位于显式上下文边界类中，token 层 SHALL NOT 枚举业务组件选择器。

已纳入**当前迁移范围**类目的值 SHALL 经 semantic token 引用，SHALL NOT 重新声明 token、直接引用 primitive 或写裸值；**未纳入当前迁移范围**的存量裸值允许保留原状，但不得新增。`app/thread-chat/styles/tokens.css` SHALL 保留为单一入口文件（内部 `@import` 分层文件）；`theme.ts` 的「深度 → CSS 变量名」映射 SHALL 指向语义 token 名，重命名 SHALL 同步更新该映射及 `anchored-markdown.tsx` 等动态拼接处。

#### Scenario: 改一处语义 token 全局生效

- **WHEN** 修改语义 token（如 `--tc-surface-base`）所引用的 primitive 值
- **THEN** 依赖它的所有区块（消息、抽屉、画布、弹层等）渲染同步变化，无需改动任何其它文件

#### Scenario: 按迁移范围判定违规

- **WHEN** 区块文件出现已纳入当期类目（颜色、z-index、prose 排版）的裸值或 primitive 直引
- **THEN** 该写法违反本要求；而未纳入当期类目的存量裸 px（如 padding 间距）允许保留，不算违规

#### Scenario: contextual fallback 无死色

- **WHEN** 检查 `--fc/--dc/--accent` 的 fallback 声明
- **THEN** fallback 均为 semantic token 引用（如 `var(--tc-depth-1)`），不存在硬编码色值

#### Scenario: contextual 边界显式声明

- **WHEN** 组件注入 `--tc-accent` 或 `--fc`
- **THEN** 同一元素挂载对应的 `.tc-accent-context` 或 `.tc-fork-context`，派生 token 文件无需知道该组件的业务 class

### Requirement: `.tc-prose` 插件式正文排版

markdown 正文排版 SHALL 收敛为 `.tc-prose` 排版类，排版值全部由 prose 语义 token 驱动：

- 迁移范围 SHALL 包含 `markdown.css` 的全部排版规则**以及** `drawer.css`（`.tc .art-body .md-body`）与 `canvas.css`（`.tc .canvas-expand .md-body h1~h4` 等）中的排版选择器，统一迁至 `.tc-prose`；`.md-body` SHALL 仅保留「锚点定位坐标系」DOM 契约（TS 字符串选择器 `closest(".md-body")` 等不变），SHALL NOT 再承担排版职责；
- 阅读档位（紧凑 / 标准 / 宽松）SHALL 由**正文容器宽度**经容器查询（`@container`）驱动，SHALL NOT 使用视口媒体查询决定正文排版（多列布局下视口宽度不代表列宽）；档位 token 挂 `.tc` 根，档位切换 SHALL 允许视觉变化并以截图基线验收；
- 尺寸修饰符（至少 `.tc-prose-compact`）SHALL 以各容器档位对应的离散偶数 token 与档位正交组合，SHALL NOT 通过产生亚像素计算值的比例缩放实现；`MarkdownBody` SHALL 通过显式 typed density 选择修饰符，场景区块 SHALL NOT 直接覆写 `.tc-prose` 或标题字号；
- 迁移时排版值 SHALL 遵守数值规范（整数偶数 + 待查验标注）。

#### Scenario: md-body 仅保留 DOM 契约

- **WHEN** 对 `app/thread-chat/styles/` 扫描排版相关选择器
- **THEN** 全部为 `.tc-prose` 形式（含 drawer/canvas 内的正文选择器），`.md-body` 仅出现在 TS 锚点定位逻辑中

#### Scenario: 容器档位驱动排版

- **WHEN** 同一视口下多列布局中某列变窄
- **THEN** 该列内 `.tc-prose` 按自身容器宽度套用对应档位排版，不受视口宽度误导

#### Scenario: 修饰符与档位正交

- **WHEN** 给正文容器追加 `.tc-prose-compact`
- **THEN** 段距与字号按缩放系数缩小，容器档位变化（窄列/宽列）仍然生效，两者不互相覆盖

### Requirement: 主题覆盖经由语义层

颜色替换型主题调整（品牌色、深度轴替换、强调色调整）SHALL 可通过仅修改 `tokens/` 基础文件中的 primitive 值完成，SHALL NOT 需要修改区块样式文件或 `.tc-prose` 规则。`theme.ts` 的「深度 → CSS 变量名」映射 SHALL 以语义 token 名（`--tc-depth-*`）为准。深浅色双主题与 JavaScript 主题配置注入机制不在本变更范围内。

#### Scenario: 仅改配置完成深度轴替换

- **WHEN** 通过修改 primitive 色板替换 depth 轴的五个颜色值
- **THEN** 区块样式与正文排版无需任何改动即可渲染新主题
