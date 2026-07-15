# 任务拆解：Phase A 气泡输入框

## 1. 前置修复

- [x] 1.1 selection-bubble 的 capture scroll 监听放行 `.sel-bubble` 内部滚动（D4，参考 playground commit e5dc0f9 的修法）；顺手确认现有行为无回归（划选→页面滚动仍关气泡）

## 2. 气泡输入框

- [x] 2.1 selection-bubble 加单行自增高 textarea（placeholder「就这段问点什么…（可留空）」，clamp ~68px，弹出即 `focus({preventScroll:true})`）+ question state
- [x] 2.2 键位流（D3）：Enter 提交 / Shift+Enter 换行 / ⌘Enter keepSource / Esc 壳层链；**IME isComposing+keyCode229 守卫**；按钮与 Enter 共用 submit()
- [x] 2.3 按钮文案（初版四态；后按 D9 修订为两态 + .place-hint 放置提示行）
- [x] 2.4 CSS：输入区样式（.tc 纸面语言）+ 贴底翻转阈值随气泡高度调整（D5）

## 3. 提交链路

- [x] 3.1 `handleFork(s, hint, question?)`：question 非空 → fork + openThread 后 `chat.send(threadId, question)`（不进预填流）；留空路径零改动（D1/D2）
- [x] 3.2 `net/prompt.ts` kickoffQuestion 文案更新为「请结合上下文，展开讲解『{X}』」（D6）
- [x] 3.3 继承段字符预算（D8）：常量 INHERITED_CHAR_BUDGET=6000 进 constants/；buildRequestBody 从最新往回累计、超停（保底 1 条）、丢弃时插「（更早的 N 条上文已省略）」说明消息；配一个纯函数快测（node --experimental-strip-types，入 e2e/ 或就近）

## 3.5 异步分支标题（D7）

- [x] 3.5.1 新路由 `app/api/branch-title/route.ts`：POST {anchorText, question, answer 摘录} → minimaxModel generateText 4–8 字标题（超长截断、空回退默认），照主聊天 generateTitle 先例
- [x] 3.5.2 `core/store.ts` 新 mutator `setThreadTitle(threadId, title)`（原子 + notify）；客户端触发：分支首答 finish 后一次（Set ref 防重、失败 console.warn 静默），标题变更随整树防抖存盘持久化

## 4. 验收（真实执行，全绿才算完）

- [x] 4.1 `pnpm typecheck` 0 错；`npx eslint app/thread-chat` 0 报
- [x] 4.2 新入库脚本 `e2e/thread-chat/verify-bubble-composer.mjs`（断言面参考 playground verify6 + 我们的 IME 关注点）：带问 Enter → 新列第 1 条 = 该 user 消息、第 2 条 assistant 流式、composer 无预填；留空 Enter/点按钮 → 预填流逐项如故（复用 kickoffQuestion() 生成期望值）；⌘Enter keepSource；Shift+Enter 换行不提交；长问题自增高气泡不自毁；文案四态；输入中 Esc 关气泡无消息入树；CDP 组合态 Enter 不提交；**分支首答完成后标题异步变为语义标题且刷新仍在**；深树预算截断纯函数用例（超算即停/保底 1 条/省略说明）
- [x] 4.3 既有 e2e 回归：verify-live / verify-persist / verify-tree-list 全 PASS（预填文案断言改从 kickoffQuestion() 导入生成）
- [x] 4.4 `pnpm build` 通过

## 5. 文档收尾

- [x] 5.1 e2e README 补 verify-bubble-composer 一段；`pnpm openspec:validate` 通过

## 6. 实施后用户反馈迭代（均已完成并验证）

- [x] 6.1 D9：按钮两态 + 放置提示行（替代四态文案；e2e 断言同步）
- [x] 6.2 修复 smcell className 粘连导致的列条样式退化（恢复原版拼法，格子/白框/斜纹/cap 小字回归）
- [x] 6.3 D10 方向 C：Message.quote 字段 + 引用条渲染（列/画布）+ 字段驱动 grounding + 服务端指代规则；e2e 含「刷新后引用仍在」断言
- [x] 6.4 「新对话」空树无操作（URL 不变 + 轻提示；归属 add-branch-tree-persistence 的 URL 身份语义，spec 已同步）
- [x] 6.5 正文阅读字体改无衬线（--font-read 跟随 --font-ui）；恢复 .md-body 列表 marker（Tailwind preflight 吞 list-style）
