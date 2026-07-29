# thread-chat-styling Specification

## Purpose
TBD - created by archiving change split-thread-chat-css. Update Purpose after archive.
## Requirements
### Requirement: 设计 token 单一来源

thread-chat 的设计 token（`--paper/--ink/--rule/--d1..--d5/--font-*/--col-min/--lane-max` 等，挂在 `.tc` 根、靠继承供全体子元素取用）SHALL 只在一个文件（`app/thread-chat/styles/tokens.css`）中定义。其它样式文件与组件 SHALL 通过 `var(--token)` 引用，SHALL NOT 重新声明这些变量。`theme.ts` 的「深度 → CSS 变量名」映射依赖此处的变量名，重命名 token SHALL 同步更新该映射。

#### Scenario: 改一处 token 全局生效

- **WHEN** 修改 `styles/tokens.css` 中某个 token（如 `--paper`）的值
- **THEN** 依赖它的所有区块（消息、抽屉、画布、swx 弹层等）渲染同步变化，无需改动任何其它文件

### Requirement: 样式按功能区块分文件

thread-chat 的样式 SHALL 按功能区块拆分到 `app/thread-chat/styles/` 下的多个文件（顶栏、列布局、消息、输入框、划选气泡、切换器、抽屉、toast、画布、markdown、会话列表等），单个文件聚焦一个区块。`app/thread-chat/thread-chat.css` SHALL 作为桶文件存在（仅 `@import` 各区块文件），保持两个入口（`tree-redirect.tsx`、`thread-chat-demo.tsx`）的 `import "./thread-chat.css"` 路径不变。全部选择器 SHALL 保持 `.tc` 手工作用域（不引入 CSS Modules / Tailwind 原子化）。

#### Scenario: 定位某区块样式

- **WHEN** 需要修改划选气泡的样式
- **THEN** 相关规则集中在 `styles/selection.css` 单个文件内，无需在 2000+ 行单体中翻找

### Requirement: 拆分对最终渲染零影响（级联等价）

桶文件按约定顺序 `@import` 区块文件后，页面的最终计算样式与级联结果 SHALL 与拆分前**逐像素一致**。`@import` 顺序 SHALL 保证：对任一元素，拆分前后胜出的规则相同。等价性 SHALL 以构建产物 CSS 无实质差异 + 关键页视觉回归验证。

#### Scenario: 交错追加块归位不改变胜出规则

- **WHEN** 把源码中被后续变更追加在文件尾部、与其本体不相邻的块（如折叠细条、swx 子树弹层、划选引用条、帮助 icon）归入其功能文件
- **THEN** 因这些块的类集与其"跨过"的区块互不相交，任一元素的胜出规则不变，视觉回归无差异

