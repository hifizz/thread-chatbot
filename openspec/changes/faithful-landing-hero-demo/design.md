## Context

现状：`components/landing/hero-demo/` 用自绘结构模拟三列追问（`hero-demo.tsx` 编排顶栏/列/章节，`thread-pane.tsx` 渲染列头/消息/输入框，`use-demo-sequence.ts` 输出播放时间线，`cursor-layer.tsx` 落虚拟游标，`demo-popover-content.tsx` 做 Base UI 弹层），样式全收敛在 `.threadchat-landing` 下。这是 `replace-home-with-interactive-demo` 有意立的隔离边界：演示不准用真实工作台的 `.tc` 类、不共享工作台代码。

用户确认的取舍：**高保真仿制**（不动现有仿制骨架）＋**完整核心交互**＋**沿用六套剧本**＋**保留播放与游标**。真实对照源已核实：列头/横幅/`继承的上文`在 `app/thread-chat/branching/branchable-chat.tsx:136-229`；单会话消息流与 composer 插槽在 `app/thread-chat/chat/chat-view.tsx:63-145`；用户/助手消息与工具条挂载在 `app/thread-chat/chat/message/conversation-message.tsx:79-166`；划选两步（工具条→气泡提问）在 `app/thread-chat/branching/selection/selection-toolbar.tsx` 与 `selection-bubble.tsx:202-213,306-421`；输入框元素在 `app/thread-chat/chat/composer/conversation-composer.tsx:29-58`（附件/模型/参数/语音占位/发送）；Artifact 卡结构在 `orchestration/artifacts/{markdown-artifact-card.tsx,message-artifacts.tsx}`；列容器/细条/分割线在 `orchestration/columns/thread-columns.tsx:23-105`；顶栏分段在 `orchestration/navigation/thread-chat-topbar.tsx:185-306`；锚点高亮/脚注为渲染后 DOM 手绘（`branching/assistant/anchored-markdown.tsx:60-137`），演示侧用按钮式锚点近似即可。

## Goals / Non-Goals

**Goals:**

- 顶栏、列头、横幅、消息气泡、锚点/脚注、消息工具条、输入框、Artifact 卡、细条、分割线、滚到底按钮在视觉与行为上与工作台一致到“可操作”程度。
- 划选→提问→右侧开分支、分支内发送、列切换/收起/拖宽、`@` 胶囊引用/移除/发送、复制/重生成/反馈全部本地可用。
- 六套剧本内容、章节播放、游标、暂停/重播、窄屏横滑、样式隔离全部保留。

**Non-Goals:**

- 不复用真实工作台组件、不引 `.tc` 样式、不共享 store/runtime/DB 逻辑；不新增依赖。
- 不做画布视图、Project 抽屉全量、真实附件上传、语音输入、鉴权、i18n；不調模型、不建会话、不写库。
- 不重写 `constants/landing-demo.ts` 的剧本文案，只做最小结构扩展（如需）。

## Decisions

### 1. 仿制对齐，不复用真实组件

现状骨架保留，原地加深。复用 `BranchableChat/ChatView/ConversationComposer` 意味着连带拖入 `.tc` 样式体系、Lexical 输入框、`MessageScroller`、workspace overlays 与 normalized store，与首页隔离边界直接冲突。仿制则 blast radius 限于 `components/landing`，回滚安全。代价是与工作台长期存在漂移，以 spec 的 WHEN/THEN 作为对齐契约锁住。

### 2. 状态分两层：播放时间线 vs 本地演示态

`use-demo-sequence.ts` 的 `viewAt()` 时间线只管剧本播放（可见列、流式文本、弹层、提及、artifact 就绪）。新增的本地态（划选、列槽/折叠/宽度、发送内容、工具条反馈、`@` 胶囊）放在 `DemoPlayer` 级 state，与 timeline 输出合并、`interact()` 暂停播放的既有机制复用。避免播放 tick 冲掉用户手操作，也避免手动态污染剧本回放；`jump(0)` 重置两层。

### 3. 放置策略本地精简实现

工作台 `orchestration/columns/placement.ts` 的 replace/fold＋`targetId > keepSource > 默认`＋预览共用一套代码，但它依赖 `core/selectors` 的 LRU。演示侧新建 `hero-demo/demo-placement.ts` 做同语义精简版（上限来自视口/强制列数，LRU 用本地活跃序），气泡迷你列条与提交共用它，保证“预览不撒谎”。不直接 import 工作台 placement，守住“不共享工作台代码”的提案约束；重复的是约 60 行纯函数，可接受。

### 4. 划选走原生 Selection，定位抄浮层模型

助手正文容器监听 `mouseup/selectionchange`，命中 `.landing-demo` 内助手 prose 才弹两键工具条（`在当前对话问`/`此处提问`，文案复用 `SELECTION_TOOLBAR_COPY`，箭头键导航同真实工具条）。选“此处提问”进气泡（引用＋可选首问＋迷你列条＋`开启分支讨论`/`带着问题开分支`，几何常量复用 `BUBBLE_W/BUBBLE_GAP/BUBBLE_SAFE_PADDING`）。空提交保留 kickoff 预填待确认，非空直接成为新分支首条 user 消息。定位用 rect 相对演示容器换算＋边界夹取，不引入 `bubble-position/bubble-shape` 的 SVG 尾巴，用圆角面板＋小三角近似。

### 5. 输入框用 textarea 壳、摆出工作台元素

Lexical 不引入。`composer-inner` 内补齐：附件按钮（装饰＋本地托盘）、模型选择（主列可用简单菜单，分支列锁定并提示 `COMPOSER_MODEL_COPY.branchLocked`）、参数入口（演示态小面板）、语音 disabled 占位、发送/停止键（流式中变停止）。`@` 菜单沿用现有 `Command`＋Popover，胶囊为不可编辑 pill＋`X` 移除，占位文案用 `ARTIFACT_REFERENCE_COPY.placeholder`。常量全部走 `constants/`，不内联魔法串。

### 6. 消息工具条与 Artifact 卡按真实结构摆

工具条顺序/图标与 `AssistantMessageToolbar` 对齐：复制（Copy/Check）、重生成（RotateCcw，仅最新可点）、赞成/反对（ThumbsUp/Down 本地 pressed），disabled 给出与 `MESSAGE_ACTION_ERRORS` 同义的 tooltip。复制走 `navigator.clipboard`，重生成重播本 lane 流式，失败只在本地 `role=alert` 提示。Artifact 卡照 `.acard` 结构（icon＋标题＋kind 行＋打开）＋深度色左缘；生成中用虚线占位卡（spinner＋字符/行数＋最近章节＋进度条），由 artifact 时间线驱动。

### 7. 列 chrome 与顶栏对齐到“可操作子集”

列头：主列 `锚定`＋`主线`＋副标题＋子分支计数；分支列可点击面包屑＋`L{depth}`＋标题＋子分支计数＋`⇄ 切换`（本地小列表）＋`收起`。横幅与`继承的上文`照 `branchable-chat.tsx:196-229` 摆（含历史回复警示的简化版）。细条照 `columns-collapse.css`（30px 竖条＋脚注徽＋竖排标题）。分割线支持拖拽/键盘/`双击`重置，宽度落本地 state。每列消息列表加滚到底按钮（贴底隐藏）。顶栏保留 列（active）/画布（disabled＋tooltip 说明演示仅列模式）、列数（自适应/2/3 可用）、替换⑥/细条⑤（可用）、会话树·N（计数＋跳转）、Project·M（计数＋本地预览），`新对话`重置演示。

### 8. 样式手工移植，不跨作用域引用

新规则全部写在 `.threadchat-landing .landing-demo` 下，按 `topbar/columns/messages/composer/selection/message-actions/artifact-card/columns-collapse.css` 的视觉值手工映射到 landing 纸面 palette，不 `@import` 任何 `.tc` 文件、不引用 `var(--tc-*)`。偶数 px 优先（landing 无工作台的亚像素注释义务，但保持一致手感）。游标 `data-cursor-target` 随新 DOM 补齐（工具条两键、气泡提交、脚注、切换、胶囊、发送、artifact）。

文件落点：`hero-demo.tsx`（顶栏/列槽/宽度/章节/游标）、`thread-pane.tsx`（列内组合，保持为组合层）、新建 `demo-selection.tsx`（工具条＋气泡）、`demo-message-actions.tsx`、`demo-artifact-card.tsx`、`demo-placement.ts`，样式续写 `landing.css`。拆分以“可读性需要”为限，不提前抽象。

## Risks / Trade-offs

- [Risk] 交互做全导致 scope 膨胀 → Mitigation：子分支面板/参数面板/附件只做最小可用（列表＋选择/开关），画布与抽屉全量明确不做。
- [Risk] 与工作台视觉漂移 → Mitigation：spec 的 8 组 WHEN/THEN 即验收契约；实现后逐条跑六剧本＋窄屏＋reduced-motion。
- [Risk] 播放时间线与手动态互相覆盖 → Mitigation：两层状态分离，`jump` 才同时重置；`interact` 一律暂停播放（沿用现有语义）。
- [Risk] 原生划选与点击 footnote/工具条冲突 → Mitigation：划选忽略工具条自身与输入框选区；`Esc`/点击空白关闭链路与现有弹层一致。
- [Trade-off] 精简 placement 与真实 LRU/替换语义可能有边角差异 → 接受，演示只需“可预测的邻右/替换/折叠”，不承诺与工作台逐 case 一致。

## Migration Plan

纯 landing 改动：改 `components/landing/**` 与 `constants/landing-demo.ts`（如需最小扩展）。无 DB、无路由、无依赖变更。回滚即 revert 本 change 的文件。验证：`pnpm typecheck`、改动范围 ESLint、生产构建、六剧本切换/分支弹层/引用/暂停重播/窄屏横滑/入口链接的手工走查。

## Open Questions

- 子分支计数按钮：只做计数＋跳转 Enzyme，还是做带标题列表的小面板？默认后者（最小）。
- 生成参数入口：做到“能开能看”即可，还是要可调且影响演示？默认前者。
- 附件按钮：纯装饰＋本地文件名托盘是否足够？默认是。
