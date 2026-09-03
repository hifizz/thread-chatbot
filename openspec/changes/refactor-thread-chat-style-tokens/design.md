## Context

thread-chat 手写样式层现状（`app/thread-chat/styles/`，22 个区块文件 + `thread-chat.css` 桶文件按序 `@import`），经全量核实：

- **token 只有 primitive 层**：`tokens.css` 定义 `--paper/--ink/--rule/--d1..--d5/字体/尺寸`；裸 px 值 544 处，其中**非偶数值 35 处**（grep 命中 36 行，其中 1 行为注释；字号 `10.5/11.5/12.5/13.5/14.5/15.5px` 为主，另有 `letter-spacing: 0.5/0.6px`、`1.5px` 边框、`-4.5px` 热区 margin 等亚像素值）。
- **颜色未收口**：hex/rgba 字面量 161 处；color-mix 46 处（混色比例 6%~72%，基底有 transparent / `#fff` / paper / paper-2 四类）；`var(--fc, #8a8377)` / `var(--dc, #8a8377)` / `var(--accent, #3a3733)` 型硬编码 fallback 30+ 处；`tree-list.css` 存在与 `--d2` 同值的裸字面量 `#b07d2e`（未保存态高亮）、功能红 `#b03a2e`（danger 按钮）直接写入，以及给 `--d1` 错挂 `--d2` 值的死 fallback（`var(--d1, #b07d2e)`）。
- **实例级动态变量**：TS 按节点深度注入 `--fc/--dc/--accent`（`theme.ts` 的 `dvar()` 模板拼接、`anchored-markdown.tsx` 内联拼 color-mix），构成 contextual 层现状；`bubble-shape.tsx` 引用 `var(--ink)`、`use-canvas-layout.ts` 引用 `var(--font-mono)`。
- **z-index 10 处裸值**：列内局部层（0/1/2/3）与弹层（60 划选 / 65 抽屉 / 72·74 切换器 / 80 toast）两族。
- **`.md-body` 是 DOM 契约**：`use-assistant-text-selection.ts`（`closest(".md-body")`）、`anchored-markdown.tsx`（`querySelectorAll(".md-body")`）依赖它；同时 `drawer.css:127`、`canvas.css:231-238` 还有 `.md-body` 排版选择器——排版职责迁移必须覆盖这两处。
- **不可打破的原则**：① px 值整数且尽量偶数，无法取偶的必须标注待查验复核；② 第一轮颜色全部 token 化（含 color-mix 收口），相近色相邻组织；③ z-index 语义变量化。
- 约束：Tailwind v4 CSS-first、`.tc` 手工作域与桶文件顺序不可破坏、无测试框架（验收靠构建产物对比 + 视觉核对）。

## Goals / Non-Goals

**Goals:**

- 三层 + contextual 分层模型落地：primitive（`--tc-palette-*`/`--tc-font-stack-*`）→ semantic（`--tc-{类目}-{语义角色}-{状态?}`）→ component（按需）；`--fc/--dc/--accent` 收口为 contextual 层，fallback 引用 semantic。
- **颜色全量 token 化**：字面量、fallback、color-mix（按用途收口）清零出 `tokens/`；颜色定义按相近色聚类；引用面覆盖 CSS + TS + TSX。
- z-index 语义化（10 处收口 + stacking context 审计）。
- `.tc-prose` 结构迁移（含 drawer/canvas 的 `.md-body` 排版选择器），排版值整数偶数化；响应式档位改**容器查询**，compact 以缩放系数正交组合。
- 双轨验收：颜色/z-index 轮计算样式等价；prose 轮允许视觉变化并以截图基线验收。

**Non-Goals:**

- 不引入 Sass/Less/CSS Modules，不用 Tailwind 原子类替换手写类，不发包。
- 不做 space / radius / elevation / state、sizing / motion / focus / scrim 类目（Future Work）。
- 不做 UI 排版 role（body/label 等字号 token）——本轮 typography 仅字体族与 prose 排版值。
- 不做深浅色双主题与 JS 主题配置注入（Future Work，独立 Change）。
- 不改 DOM 结构与组件布局逻辑。

## Decisions

### D1：纯 CSS 变量分层模型，含 contextual 层

Tailwind v4 CSS-first 与 `.tc` 变量体系同源，CSS 变量支持运行时实例注入，编译期工具做不到。在三层之上明确 **contextual 层**：由 TS 按实例注入的颜色变量（现 `--fc/--dc/--accent`）保留注入模式，但 fallback 改引用 semantic（如 `var(--tc-accent, var(--tc-depth-1))`），删除死色 fallback——这是「换肤只改配置」成立的前提。
**否决的替代**：Sass/Less（编译期变量、无法运行时注入）；直接用 `@tailwindcss/typography`（与 paper/ink 视觉语言、shiki/diff/锚点深度耦合，仅借鉴形态）。

### D2：`tokens.css` 保留单一入口，`tokens/` 分层 + 颜色聚类

入口路径不变（内部 `@import` 分层文件，桶文件 `thread-chat.css` 不动）。分层文件：`tokens/base.css`（reset/挂载）、`tokens/palette.css`（primitive 色板 + 字体栈，**按相近色分节聚类**：paper 系 → ink 系 → depth 系 → 功能色系 → 白/阴影，相邻色相邻摆放）、`tokens/surface.css`、`tokens/content.css`、`tokens/border.css`、`tokens/depth.css`、`tokens/color-derived.css`（派生色：46 处 color-mix 按用途聚类收口的归属文件）、`tokens/typography.css`、`tokens/prose.css`、`tokens/z-index.css`。原则②的「相近的颜色放到靠近的位置」由 palette.css 分节 + 各 semantic 文件按角色排序落实。

### D3：primitive 命名与全量映射表（一次性重命名，不留旧名别名）

引用面仅在 `app/thread-chat/` 内，保留旧别名只会藏违规引用。分层、命名、引用权如下：

| 层级 | 命名 | 示例 | 谁可以引用 |
|---|---|---|---|
| primitive | `--tc-palette-*` / `--tc-font-stack-*` | `--tc-palette-paper-100` | 仅 semantic 层 |
| semantic | `--tc-{类目}-{角色}-{状态?}` | `--tc-surface-base` | 区块样式与组件 |
| contextual | 实例注入变量 | `--fc` → 注入 `--tc-accent` | 使用处 + fallback 引 semantic |
| component | `--tc-{组件}-*` | `--tc-composer-border` | 仅该组件（按需创建） |

primitive 初值映射：`#fdfbf8→--tc-palette-paper-100`、`#f4f0e9→paper-200`、`#e8e2d3→paper-300`、`#faf8f2→paper-50`、`#24211b→ink-900`、`#6a6357→ink-600`、`#a79e8d→ink-400`、`#3a3733→ink-700`、`#efece4→rule-100`、`#d3cbb8→rule-200`、depth 五色→`--tc-palette-depth-1..5`、`#8a8377→--tc-palette-neutral-500`、`#b03a2e→red-600`、`#8e2626→red-700`、`#fff→--tc-palette-white`。semantic 对应：`--paper→--tc-surface-base`、`--paper-2→--tc-surface-raised`、`--user-bg→--tc-surface-sunken`、`--ink→--tc-content-primary`、`--ink-soft→--tc-content-secondary`、`--ink-faint→--tc-content-muted`、`--rule→--tc-border-subtle`、`--rule-strong→--tc-border-strong`、`--d1..5→--tc-depth-1..5`、`--font-ui/read/mono→--tc-typography-family-ui/read/code`。`dotColorOf` 的 `#8a8377` 定为 `--tc-depth-neutral`（非分支强调中性色，不与 content 文字色绑定）。功能色与白底经 semantic 引用：`--tc-danger`（red-600）、`--tc-danger-deep`（red-700，行内代码红）、`--tc-surface-plain`（white，弹层白底控件）、`--tc-content-on-accent`（white，实色底文字）。

### D4：`.tc-prose` 自研；`.md-body` 仅留 DOM 契约；迁移覆盖 drawer/canvas

容器挂 `className="md-body tc-prose"`；CSS 规则由 `.tc .md-body` 迁至 `.tc .tc-prose`，**包括** `drawer.css` 的 `.tc .art-body .md-body` 与 `canvas.css` 的 `.tc .canvas-expand .md-body h1~h4`（全部改为 `.tc-prose` 选择器），使 `.md-body` 最终只出现在 TS 锚点定位逻辑中。`.md-code` 等子结构选择器名不变。

### D5：抽值与迁移范围的判定规则

- 已纳入当期类目（颜色、z-index、prose 排版、字体族）的值必须 token 化；未纳入类目的存量裸值允许保留、不得新增——与 spec 判定口径一致。
- color-mix 按**用途**收口，初版聚类：hover 浅底（6%~9% transparent）、选中/激活底（10%~14%）、锚点高亮（20%）、锚点下划线/强调（45%~65%）、on-depth 反白文字（45%/55% `#fff` 基底）、差分行底（12%）。实施时按实际用途命名（如 `--tc-depth-{n}-hover-bg` / `-selected-bg` / `-anchor-bg` / `-anchor-underline`），逐项登记映射，避免按强度机械建 token。
- 纯几何实现细节（组件独有的 transform 位移、单处 left 偏移等）允许保留字面量并加注释；不制造单用途低价值 token。
- 字面量迁移一律**按同值归位**（`#b07d2e` → `--tc-depth-2`，计算样式不变）；死 fallback 一律清除（`var(--d1, #b07d2e)` → `var(--tc-depth-1)`，fallback 仅在变量未定义时生效，删除不改变计算样式）；判定为「应改指向」的修复（如 tlx-unsaved 是否应为 depth-1）属视觉变化，移入轨 B 登记决策。
- 不为凑类目提前建空文件：P1/P2 类目文件由其所属后续 Change 创建。

### D6：contextual 注入改造（anchored-markdown）

`anchored-markdown.tsx` 不再在 TS 内拼 color-mix 表达式，改为在元素上注入 `--tc-accent: dvar(depth)`（contextual 变量），混色统一由 CSS 派生 token 完成；`theme.ts` 的 `dvar()/accentOf()` 改产 `var(--tc-depth-N)` 并作为全仓唯一动态拼接点。

### D7：数值规范与整数化映射

新值一律整数、尽量偶数；取整规则为**银行家舍入**（round-half-to-even，如 11.5→12、12.5→12、13.5→14）。存量非偶数共 35 处（grep 命中 36 行，其中 1 行为注释），处置表：字号 `12.5→12`、`13.5→14`、`14.5→14`、`15.5→16`、`11.5→12`、`10.5→10`（逐项登记视觉微变）；`letter-spacing: 0.5/0.6px`、`outline/border: 1.5px`、`margin: 0 -4.5px`（热区几何）等亚像素值保留并附 `/* tc-review: 非偶数值，保留原因 */` 标注。prose 基准字号初值沿用现值 16px（偶数）；奇数值原则上不出现，确需保留的必须附 `tc-review` 标注。

### D8：z-index 语义层级

10 处裸值收口为两族语义 token：列内局部层 `--tc-z-column-under: 0 / -base: 1 / -raised: 2 / -top: 3`；弹层 `--tc-z-selection: 60 / -drawer: 65 / -switcher: 72 / -switcher-top: 74 / -toast: 80`。实施时对每处使用点做 stacking context 审计（祖先 transform/filter/opacity 会隔离层级），结论写入 token 注释。

### D9：响应式档位用容器查询，compact 以离散偶数 token 正交组合

多列布局下视口宽度不代表列宽（`--col-min: 340px`，1440px 视口三列时每列仅 ~420px），视口媒体查询会把大屏排版套进窄列。决策：在列容器/抽屉正文/画布面板上声明 `container-type: inline-size`，`.tc-prose` 档位经 `@container` 由**容器宽度**驱动（断点初值：窄 `<480px`、标准 `480~720px`、宽松 `>720px`，与 `--lane-max: 760px` 联动校准）。compact 等修饰符为窄/标准/宽松档分别提供离散偶数字号与间距 token，由同一容器查询切换，SHALL NOT 使用 `0.9` 乘法产生 `14.4px/12.6px` 等亚像素计算值。实施 `container-type: inline-size` 时须同步审计 containment 副作用：布局包含使该元素成为后代 `absolute/fixed` 定位的包含块，switcher 弹层（z 72/74）、help-panel 等依赖更外层定位祖先的元素需逐一核对登记。

### D10：双轨验收

- **轨 A（颜色、z-index、引用面清理）**：值不变、只改名换引用——以「构建产物 CSS 除变量名外无规则级差异 + grep 清单零命中 + 计算样式抽查等价」验收。
- **轨 B（prose 结构迁移、数值取整、容器档位）**：明确允许视觉变化——以「变更登记表 + mobile / 单列桌面 / 多列桌面 / drawer / canvas 五场景截图基线」验收。
- 两轨不得混用标准；轨 A 内若发现必须改值的项（如取整），移入轨 B 登记。

## Risks / Trade-offs

- [动态拼接漏改导致深度配色失效] → `dvar()` 收口为唯一拼接点，`anchored-markdown.tsx` 改为注入 contextual 变量；grep `--d${`、`var(--d` 清零验证 + 深度分色视觉核对。
- [字面量/引用面遗漏] → 轨 A 验收含全量 grep（hex/rgba、`var(--*,#`、旧 token 名、TS 字符串、SVG 属性默认值），零命中为准；shiki 第三方注入色白名单豁免。
- [非偶数取整带来排版微变] → D7 处置表逐项登记，截图前后对照确认；亚像素值保留并标注，不强改。
- [容器查询兼容性] → 2026 年主流浏览器均支持 `@container`；若需兼容更老目标，降级方案为「列数 + 视口」联合判断，实施前确认浏览器基线。
- [`container-type` 的 containment 改变弹层定位祖先] → D9 的定位祖先审计 + switcher/help-panel 弹层回归核对；必要时将容器声明下移到不影响弹层定位的内层包装。
- [color-mix 用途归类争议] → D5 初版聚类 + 实施登记表；单处孤例允许先挂 component/contextual 层，不强行全局化。
- [prose 迁移遗漏 drawer/canvas 选择器] → 扫描 `.md-body` 排版选择器清零作为轨 B 验收项。

## Migration Plan

1. **颜色轮（轨 A）**：建 `tokens/` 分层与 palette 聚类 → semantic/contextual 定义 → 全引用面替换（CSS+TS+TSX+fallback）→ 轨 A 验收。
2. **z-index 轮（轨 A）**：两族语义 token + 10 处收口 + stacking 审计。
3. **prose 结构轮（轨 B）**：`.tc-prose` 迁移（markdown + drawer + canvas）→ 数值取整（D7 表）→ 轨 B 截图基线。
4. **档位轮（轨 B）**：容器查询 + compact 缩放系数 → 五场景截图验收。
5. 每轮独立 commit，revert 即回滚；颜色轮与后续轮之间无交叉依赖。

> **执行顺序修订（用户指令 2026-09-02）**：第 1、2 步为第一阶段（本轮 apply，零差异）；
> 第 3、4 步整体推迟到改造验收通过后单独执行，且第二阶段先做「值原样保留」的结构迁移
> （零差异），取整与档位作为显式批准后的独立视觉变更。

## Open Questions

- 容器档位断点初值（480/720px）需与 `--lane-max`、实际列宽分布校准，实施时以五场景实测定稿。
- compact 之外是否需要 spacious 档——待实际阅读反馈，本轮仅做机制（scale 系数）+ compact。
- UI 排版 role（body/label 字号 token）归属后续哪一轮 Change。
- JS 主题配置注入机制的形态（theme.ts 扩展 vs 独立 config）——独立 Change 内决策。
