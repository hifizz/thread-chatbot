# 任务拆解：拆分 thread-chat.css

> 实现采用**严格保序连续切片**（见 design D2/D3 的修正）：等价性由机器证明兜底，浏览器视觉回归退为可选。

## 0. 基线快照（拆分前）

- [x] 0.1 备份原始 `thread-chat.css`（2428 行）到 scratchpad，作为逐行等价性比对基线
- [x] 0.2 ~~视觉基线截图~~ → 由 §3 机器证明（逐行 byte 顺序一致）取代，比截图对比更强；浏览器冒烟改为可选后续

## 1. 建目录与 token/keyframes 抽取

- [x] 1.1 新建 `app/thread-chat/styles/`
- [x] 1.2 `styles/tokens.css`：源码 1–44 行（`.tc {}` 全部 CSS 变量 + `.tc *` box-sizing reset + 基础字体），作为 token 唯一定义处；顶部注释标明单一来源、`theme.ts` 深度映射依赖此处变量名
- [x] 1.3 `styles/keyframes.css`：8 个 `tc-*` keyframes（tc-flash / progress-spin / progress-slide / pop / fade-in / pop-center / typing-bounce / caret-blink）——具名动画顺序无关，集中于此

## 2. 按源顺序切分（连续区段，不合并、不重排）

- [x] 2.1 `topbar.css`(45–144) · `columns.css`(145–433) · `messages.css`(434–741) · `composer.css`(742–843)
- [x] 2.2 `selection.css`(844–1048) · `switcher.css`(1049–1314) · `drawer.css`(1315–1487) · `toast.css`(1488–1530)
- [x] 2.3 `columns-collapse.css`(1531–1603) · `switcher-subtree.css`(1604–1625) · `canvas.css`(1626–1936) · `scrollbar.css`(1937–1955)
- [x] 2.4 `messages-stream.css`(1956–2048，含 `.send.stop` 覆盖，位置在 composer 之后) · `markdown.css`(2049–2277) · `tree-list.css`(2278–2392) · `topbar-help.css`(2393–2402) · `selection-extras.css`(2403–2428)
- [x] 2.5 切分由脚本执行，仅剪切（剔除 keyframe 行 + 前置一行文件说明注释），不改任何选择器/属性/块内顺序

## 3. 桶文件与等价性验证（硬门）

- [x] 3.1 `thread-chat.css` 清空为桶文件：顶部按**源码顺序** `@import` 全部 `styles/*.css`（keyframes 顺序无关放最前），不留任何实体规则
- [x] 3.2 **内容多重集门**：拆分前后「有意义行」（trim 非空、排除注入的文件说明注释）多重集完全一致 → 无规则丢失/新增/篡改（脚本断言通过：2388 = 2388）
- [x] 3.3 **顺序门**：剔除 keyframes 后，拆分产物按桶顺序拼接与原文件**逐行 byte-for-byte 一致**（脚本断言通过：2322 行逐行相同）→ 非 keyframe 规则相对次序不变
- [x] 3.4 **构建门**：`pnpm build` 通过；编译产物 `.next/static/chunks/*.css` 抽查含全部关键 token/类（`--paper`/`sel-bubble`/`canvas-card`/`md-body`/`swx`/`col-strip`/`send.stop`/`tc-caret-blink`/`tlx-row`/`helpx` 全部命中）→ `@import` 链端到端正确
- [ ] 3.5（可选）`/browse` 复拍关键页浅/深主题冒烟对比——非放行前置，机器证明已覆盖"任何规则内容/次序变化"

## 4. 收尾

- [x] 4.1 `pnpm typecheck` 0 错误；`npx eslint app/thread-chat` 0 报错
- [x] 4.2 核对 `tree-redirect.tsx` / `thread-chat-demo.tsx` 的 `import "./thread-chat.css"` 未改（`git diff` 为空）；`theme.ts`/`use-canvas-layout.ts` 引用未受影响（类名/`.tc`/变量名皆保留）
- [x] 4.3 `CLAUDE.md` 补一段：thread-chat 样式已按区块拆到 `styles/`、桶文件保序 `@import`、token 单一来源在 `styles/tokens.css`、后缀文件为保序而拆
- [x] 4.4 `pnpm openspec:validate` 通过；提交前统一 `pnpm format`
