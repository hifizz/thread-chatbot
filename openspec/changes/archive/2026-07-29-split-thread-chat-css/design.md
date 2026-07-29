# 设计：拆分 thread-chat.css

## Context

- `thread-chat.css` = 单文件、2428 行、355 条规则，**全部**是 `.tc` 后代选择器（手工命名空间，等价于一套 hand-scoped 的 BEM-ish 系统）。类名语义化（`.msg-list`/`.canvas-card`/`.sel-bubble`/`.swx`/`.acard`/`.md-body`），**无原子类**。
- 设计 token（`--paper/--ink/--rule/--d1..--d5/--font-*/--col-min/--lane-max`）挂在 `.tc` 根，靠继承供全体子元素取用；`theme.ts` 做「深度 → CSS 变量名」映射，`use-canvas-layout.ts`/多个组件注释都与本文件的类同步。
- 消费端 3 处挂 `.tc` 根（`tree-redirect.tsx`、`thread-chat-demo.tsx` ×2），16 个组件用这些类，且**重度依赖状态类**：`.on/.closing/.show/.folded/.here/.branch/.main` + 深度类，靠模板串 `${x?"on":""}` 切换（~15 处）。
- 关系型/有状态特征密集：45 行伪类、35 处组合器 `> + ~`、8 处 `[data-*]`、3 处 `:has/:is`、8 个 `tc-` keyframes、拖拽调宽的 `.easing` 过渡门控、reduced-motion 降级、SVG minimap 的 `.fc-N` 深度染色。
- 全站其余部分（shadcn/ui）用 Tailwind v4（CSS-first，token 在 `globals.css` 的 `@theme`）；`.tc` 里 model-selector 也混了少量原子类；且本文件第 2099 行专门在**对抗 Tailwind preflight**（`list-style:none` 吞 marker）——即页面里 Tailwind 一直在跑，这层是刻意手写的并行视觉层。

## Goals / Non-Goals

**Goals:**

- 把单体切成按功能区块的小文件，定位/修改样式不再翻 2400 行。
- 设计 token 有唯一定义处（single source of truth）。
- 拆分对最终渲染**零影响**（逐像素、级联等价），可机器/视觉验证。
- 不堵死后续路：日后想把某个自包含区块转 CSS Module、或把 token 镜像进 Tailwind `@theme`，都能单独小步做。

**Non-Goals:**

- 任何 JSX/className 改动、视觉或交互调整。
- CSS Modules 全量迁移；Tailwind 原子化重写组件；删除 `.tc` 命名空间。
- 引入 `@apply`、任意变体、或把状态类改成 data-属性。

## Decisions

### D1：纯拆分保留 `.tc`，不上 CSS Modules / Tailwind（本次）

**选择**：维持 `.tc .xxx` 手工作用域与全部语义类名，仅把文件物理切开；桶文件 `@import` 保序。

**理由**：这层的价值恰在 **token 继承 + 基类共享（`.swx`/`.md-body`）**，而这正是 CSS Module 最别扭（变量/共享要另开全局 + `composes`）、Tailwind 最打架（关系型/状态型 → 变体汤）的部分。纯拆分用零风险方式解决真痛点（"太长"），且把 token 抽成单一来源后，两个世界（手写 CSS / Tailwind）日后都能读。**弃选**：① Tailwind 整体替换——每个用点炸成长串 atom、`.on/.closing` 另接 variant、`:has`/组合器无处安放，复杂度净增；② CSS Modules 全量——token/reset 留全局、15 处状态切换 + 跨区块共享全改，是独立大项目，收益（自动作用域）不足以在本次一次性偿付。

### D2：严格保持源顺序切片；桶文件按源顺序 `@import`（实现落定）

**选择**：沿源码注释横幅切成**连续区段**，每段 → 一个文件，放 `app/thread-chat/styles/`。**不合并非相邻区段**——同一功能在源码里出现两段（因后续 openspec 变更追加在文件尾部）时，拆成本体文件 + 带后缀的追加文件（`columns.css` / `columns-collapse.css`），追加文件在桶文件里保持其**原始源顺序位置**。`thread-chat.css` 原地留作桶文件，内容 = 一叠 `@import`，顺序**严格等于原文件自上而下的顺序**。入口 `import "./thread-chat.css"` 两处不动。

**理由（相较初稿的关键修正）**：初稿曾想把非相邻区段合并进功能文件（如把 1956–2048 流式并入 `messages.css`）并接受轻微重排。实现时发现这**有真实级联风险**：流式区块的 `.send.stop`（2039）覆盖 composer 的 `.send`（830）——若把流式并入 messages 并上移到 composer 之前，覆盖关系反转。故放弃合并/重排，改为**严格保序连续切片**：每个非 keyframe 规则的相对次序 by-construction **逐行不变**，切分对渲染**证明性零影响**，无需任何视觉回归赌注。

**源码区段 → 文件映射**（18 个区段文件 + `tokens`/`keyframes`；行号基于 2428 行版本，桶文件按此顺序 `@import`）：

| 源行段    | 区块                                                   | 目标文件               |
| --------- | ------------------------------------------------------ | ---------------------- |
| （散落）  | 8 个 `tc-*` keyframes（顺序无关，最先 import）         | `keyframes.css`        |
| 1–44      | `.tc` 根 token + box-sizing reset + 基础字体           | `tokens.css`           |
| 45–144    | 顶栏 brand / seg / tbtn                                | `topbar.css`           |
| 145–433   | 列布局 + 列间分割线（拖拽/键盘调宽）                   | `columns.css`          |
| 434–741   | 消息 + 功能要点列表 + 消息内 artifact 卡               | `messages.css`         |
| 742–843   | 输入框 composer                                        | `composer.css`         |
| 844–1048  | 划选气泡 sel-bubble                                    | `selection.css`        |
| 1049–1314 | 会话切换器 swx                                         | `switcher.css`         |
| 1315–1487 | Artifact 抽屉舞台                                      | `drawer.css`           |
| 1488–1530 | Toast                                                  | `toast.css`            |
| 1531–1603 | 折叠细条 col-strip + 列头子分支按钮                    | `columns-collapse.css` |
| 1604–1625 | 子树弹层（复用 swx 体系）                              | `switcher-subtree.css` |
| 1626–1936 | 画布模式 + 节点外挂对话面板                            | `canvas.css`           |
| 1937–1955 | 滚动条 / 动效降级                                      | `scrollbar.css`        |
| 1956–2048 | 流式状态（含 `.send.stop` 覆盖，必须在 composer 之后） | `messages-stream.css`  |
| 2049–2277 | Markdown md-body + 表格 + 代码块 + 锚点/脚注           | `markdown.css`         |
| 2278–2392 | 会话列表弹层 tlx（复用 swx）                           | `tree-list.css`        |
| 2393–2402 | 顶栏「帮助」icon 按钮                                  | `topbar-help.css`      |
| 2403–2428 | 划选放置后果提示 + user 气泡引用条                     | `selection-extras.css` |

共 19 个物理文件。多出的 `-collapse/-subtree/-help/-stream/-extras` 后缀文件正是为保序而不合并的产物——命名清楚说明它们是各自功能的「后续追加段」。

### D3：等价性以机器证明为硬门（不依赖浏览器回归）

**选择**：因 D2 严格保序、逐行不重排，等价性可**机器证明**，作为硬验收门（tasks §3）：① 源码「有意义行」多重集在拆分前后完全一致（无规则丢失/新增/篡改）；② 剔除 keyframes 后，拆分产物与原文件**逐行顺序 byte-for-byte 一致**（证相对次序不变）；③ keyframes 多重集一致且顺序无关；④ `pnpm build` 通过且编译产物含全部关键规则。四者齐备 ⇒ 渲染证明性不变。

**理由**：逐行 byte 等价比人眼截图对比**更强**——它排除的是"任何规则内容或次序发生变化"，而非仅"我碰巧注意到的视觉差异"。浏览器视觉回归退为**可选**冒烟（若需，用 `/browse` 复拍关键页），不作为放行前置。

### D4：设计 token 单一来源；镜像进 Tailwind `@theme` = 可选后续，不在本次

**选择**：token 全部集中在 `tokens.css` 的 `.tc {}` 块，作为唯一定义处。**不**在本变更里把它们复制进 `globals.css` 的 Tailwind `@theme`。

**理由**：`@theme` 镜像的收益是"未来 Tailwind 原子也能用这套暖色"，纯属**投机性**，且要动 `globals.css`（本变更想保持 thread-chat 目录内自洽、零全局改动）。它是**纯追加、可随时独立做**的一小步，硬塞进来只会稀释本次"零风险搬运"的确定性。留作 Non-goal / 后续小变更。**弃选**：本次就镜像——扩大 blast radius，换不来当前任何调用方的好处（YAGNI）。

### D5：keyframes 聚拢到 `keyframes.css`

**选择**：8 个 `tc-*` 具名动画统一放 `keyframes.css`，最先 `@import`（或紧随 tokens）。

**理由**：`@keyframes` 是全局具名、**顺序无关**，聚拢不影响级联，且让"这套动画有哪些"一目了然；引用它们的 `.tc` 规则散在各区块文件里照常工作。

## Risks / Trade-offs

- **风险：级联被无意改变** → 缓解：D2 严格保序、逐行不重排 ⇒ 非 keyframe 规则 byte-for-byte 顺序一致（机器证明，D3）。这是本变更唯一实质风险，已被消除而非仅"降低"。
- **风险：`@import` 的加载/解析差异**（Next + Tailwind v4 lightningcss 对被组件 import 的 CSS 里的 `@import`）→ 缓解：`@import` 全部置于桶文件顶部、仅引本地相对路径；`pnpm build` 通过且编译产物含全部关键规则即证链路正确。若 bundler 对 `@import` 处理异常，退化为在两个入口 tsx 里直接逐个 `import "./styles/*.css"`（按序），仍不改任何 className。（实测 build 通过、产物含全部 token/类。）
- **权衡：文件数（19）vs 绝对保序** → 为不合并非相邻区段而多出 5 个 `-collapse/-subtree/-help/-stream/-extras` 后缀文件。取保序（证明性零风险）优先于把文件数压到最少；后缀命名已把"它是某功能的后续追加段"讲清楚。

## Migration / 后续可选路（非本次范围）

```
本次：单体 → 桶文件 + styles/*.css（保 .tc，零 JSX 改动，零视觉变化）
  └─ 之后（各自独立小变更，按需）：
       ├─ token 镜像进 Tailwind @theme（D4）—— 打通两世界
       └─ 把"自包含 · 少共享 · 少状态"的区块（toast / 代码块 / 帮助面板）
          逐个转 CSS Module；.swx / .md-body / token 这类高共享层永远留全局
```
