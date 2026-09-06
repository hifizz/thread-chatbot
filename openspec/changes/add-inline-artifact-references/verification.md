# 验证记录

基线：main `9277d919ed25ac24d7ac3c7735d7f78643a3bd56`。

## 已执行

- `pnpm test:thread-chat:artifact-references`：有序 Parts、标题/正文不可伪造、正文完整送入 AI SDK 模型消息、单条消息重复去重、固定 ID、字符和次数预算、Drizzle Project 作用域及来源状态、send/edit/fork 命令透传与失败回滚、Lexical 文档和结构化剪贴板 round-trip、中文触发和候选搜索。
- `node --import tsx e2e/thread-chat/normalized-client-store.test.mjs`。
- `node --import tsx e2e/thread-chat/prompt-cache-contract.test.mjs`。
- `node --import tsx e2e/thread-chat/normalized-v1-api-contract.test.mjs`。
- `pnpm typecheck`、改动 TypeScript/JavaScript 文件 ESLint、`git diff --check`。
- `pnpm exec openspec validate add-inline-artifact-references --strict --no-interactive`。

作用域测试使用真实 Drizzle SQL 构建器和 executor 测试替身，没有真实数据库连接。Lexical 测试在无 DOM 的编辑器中运行，不代表浏览器键盘和布局验收。

## 浏览器待验

开发环境启动后打开 `/thread-chat-gate-3-harness/artifacts`。该页面只在 development 可用，沿用本地 Gate 3 鉴权例外，不调用真实 API 或模型。

1. 输入 `对比@`，分别选择深层分支与当前 Thread 的 Artifact；前后继续输入文字，发送后检查 Parts 的 text/ref 顺序。
2. 同名候选按来源区分；未完成候选不可选。输入邮箱不弹菜单；方向键、Enter、Escape 和中文输入法确认互不冲突。
3. Backspace/Delete 整体删除引用；Undo/Redo 恢复引用身份。复制、剪切、粘贴混排内容不退化为普通标题。
4. 列与画布切换保留同一个 Thread 的草稿；不同 Thread 草稿隔离。模拟失败保留内容；成功后清空已提交内容。
5. 编辑已发送内容恢复引用；在真实页面检查 Ctrl/Cmd+Enter 提交编辑和历史引用点击打开原 Artifact。
6. 测试页默认勾选“输入框置底”。输入 `@` 检查菜单向上展开；取消置底后应有空间向下展开。分别切换列/画布，检查选择、方向键和菜单内部滚动。窄视口右边缘、窗口缩放及移动软键盘出现时菜单须保持在可视区域内；打开、滚动、关闭菜单前后，`document.documentElement.scrollHeight` 不增加。

## Popover 溢出修复

- 原定位逻辑依赖编辑器内部上方空间，单行底部输入框无法翻转；body 绝对定位 anchor 会产生页面溢出。
- 使用固定的 portal 容器隔离 Lexical 内联定位，按实际光标及 visualViewport 选择上下方向、限制宽高；长列表内部滚动，打开期间跟随画布和视口移动。
- Artifact 回归测试增加上下翻转、窄视口左右边界、长列表和带偏移的软键盘视口几何断言。几何测试不代表浏览器布局验收。
- 本次尝试打开开发测试页，浏览器返回 `ERR_BLOCKED_BY_CLIENT`；上述浏览器步骤仍待验。

## 数据库与模型待验

1. 同 Project 建立主线、兄弟和深层分支；分别产出已完成 Artifact，其中正文末尾包含唯一可核验信息。
2. 在上述每种 Thread 中引用其他 Thread 及自己的 Artifact，问题要求读取末尾信息；确认回答根据全文，不依赖仅标题或摘要。
3. 伪造其他 Project/其他用户的 Artifact ID，应拒绝；不存在或来源未完成亦拒绝，草稿保留。
4. 编辑、重试、Fork、刷新后保留引用和顺序；来源重新生成后，历史引用仍指向原 ID 和原正文。
5. 检查模型上下文仅展开显式引用的 Artifact，不携带未引用分支的整段对话。
