# 拆分 thread-chat.css 单体样式

## Why

`app/thread-chat/thread-chat.css` 已膨胀到 **2428 行 / 57KB / 355 条规则**，是一套手工命名空间（全部收敛在 `.tc` 作用域）的手稿风设计系统：设计 token、19 个功能区块、8 个 `tc-` keyframes 全挤在一个文件里。定位样式要靠注释横幅翻页，改一处要提防跨区块的 `.swx`/`.md-body` 共享基类，`.tc` 根上的 token 是全局继承的命脉却和 2000 行细节混在一起。这是纯粹的**可维护性债**——文件本身按注释横幅已分好段，沿缝拆开即可，无需重写视觉。

探索结论（见 design）：这层是**关系型 + 有状态 + token 驱动**的手工视觉层（45 行伪类、35 处组合器、`:has`、data-属性、拖拽/降级门控、SVG minimap 深度染色）。因此：

- **Tailwind 整体替换 = 反模式**：原子模型和关系型/状态型选择器天生打架，只会写成 `[&_.x]:...` 任意变体汤或 `@apply` 搬家，还把每个 JSX 用点撑爆、`.on/.closing` 状态另接 variant 管线。**不做。**
- **CSS Modules 全量迁移 = 中等收益但非干净胜利**：token/reset 必须留全局、`.swx`/`.md-body` 跨区块共享要 `composes`、~15 处模板串状态切换要全改。是个真项目，**本次不做**，留作后续按区块渐进的可选项。
- **纯拆分（多文件 plain CSS，保留 `.tc`）= 性价比最高**：零 JSX 改动、零行为风险，直接解决"单体太长"这个真痛点，且不堵死日后局部转 Module 的路。**这就是本变更。**

## What Changes

- **按源码顺序把单体 CSS 切成连续区段文件**（18 区段文件 + `tokens.css` + `keyframes.css` = 19 个），落在新目录 `app/thread-chat/styles/`；`thread-chat.css` 原地保留为**桶文件**，内容改为按原始源码顺序 `@import "./styles/*.css"`。两个入口（`tree-redirect.tsx`、`thread-chat-demo.tsx`）的 `import "./thread-chat.css"` **一字不改**。
- **严格保序、不合并非相邻区段**：同一功能被后续变更追加在文件尾部时（如 columns↔折叠细条、composer 的 `.send`↔流式的 `.send.stop` 覆盖），拆成本体 + 后缀追加文件（`columns-collapse.css`/`messages-stream.css` 等），在桶文件里保持其原始位置，**不重排**——从构造上保证每个非 keyframe 规则相对次序逐行不变。
- **设计 token 单一来源**：`.tc` 根的 CSS 变量 + box-sizing reset + 基础字体抽到 `styles/tokens.css`，成为唯一定义处（`theme.ts` 的深度→变量映射照旧读它，不改）。
- **8 个 `tc-` keyframes** 收到 `styles/keyframes.css`（具名动画顺序无关，聚拢零风险）。
- **正确性铁律（机器证明）**：拆分前后①源码有意义行多重集一致、②剔除 keyframes 后逐行顺序 byte-for-byte 一致、③build 通过且产物含全部规则 ⇒ 渲染证明性不变。视觉回归退为可选冒烟。

范围**不含**：任何 JSX/className 改动、任何视觉/交互调整、CSS Modules 化、Tailwind 原子化、把 token 镜像进 Tailwind `@theme`（列为可选后续，见 design D4）。

## Capabilities

### New Capabilities

- `thread-chat-styling`: thread-chat 样式层的组织契约——设计 token 单一来源、样式按功能区块分文件、桶文件 `@import` 顺序保证级联等价（拆分对最终渲染零影响）。

## Impact

- **前端（纯样式文件搬运）**：新增 `app/thread-chat/styles/*.css`（19 个：18 区段文件 + `keyframes.css`）；`app/thread-chat/thread-chat.css` 从 2428 行实体变为一叠 `@import` 的桶文件。
- **不改**：所有 `.tsx`（className 一字不动）、`theme.ts`、`use-canvas-layout.ts` 等引用 `.tc`/类名的逻辑；`globals.css` 与 Tailwind 配置；DB/API/构建脚本。
- **风险**：极低且已验证消除——纯文件切分、严格保序、不重排；等价性以机器证明（行多重集一致 + 剔 keyframes 后逐行 byte 顺序一致 + build 产物含全部规则）为硬门，非"人眼兜底"。
