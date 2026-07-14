# thread-chat e2e 验收脚本

`/thread-chat`（分支对话页）的验收脚本，均无需测试框架。

注：verify-live / verify-bubble-composer 直接 import 产品代码（`.ts`）生成断言
期望值（kickoff 预填文案、默认分支标题等——文案改一处，测试期望自动跟随），
因此需要带 `--experimental-strip-types` 运行（与 text-anchor.test.mjs 同一机制）。

## text-anchor.test.mjs — 锚点定位纯函数用例（无需 dev server）

```bash
node --experimental-strip-types e2e/thread-chat/text-anchor.test.mjs
```

覆盖 `app/thread-chat/branching/text-anchor.ts` 纯字符串层的三层降级定位
（position → exact → fuzzy）：position 直接命中、exact 多处命中经 prefix/suffix
上下文消歧、**fuzzy 原文被改几个字后仍以 score≥阈值 命中正确区间**、
阈值抬高 / 彻底无关锚点判定丢失（返回 null）、fuzzySubstring 单字错漏容忍。

## prompt-budget.test.mjs — 继承段字符预算纯函数用例（无需 dev server）

```bash
node --experimental-strip-types e2e/thread-chat/prompt-budget.test.mjs
```

覆盖 `app/thread-chat/net/prompt-pure.ts` 的继承段预算截断（openspec:
add-bubble-composer D8）：预算内不截断、超预算从最旧整条丢弃（顺序保持）、
恰好等于预算的边界、**最新 1 条独超预算仍保留（保底 1 条）**、省略说明与
kickoff 文案形状。

## verify-live.mjs — 真实后端端到端验收

前提：dev server 已在 3000 端口（`pnpm dev`）、`.env.local` 配好 MiniMax key、本机有 Chromium。

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium node --experimental-strip-types e2e/thread-chat/verify-live.mjs
```

断言覆盖：页面加载、主线真实流式回复、**富文本 Markdown**（`.md-body` 渲染出
结构化元素、正文无裸 `**` / `#` 记号）、划选渲染后的正文开分支气泡、分支列打开但
**不自动发请求**（composer 预填代拟问题、消息区为空、2 秒内无新 /api/chat POST）、
回车确认后代拟问题成为真实 user 气泡、分支流式首答、**主线源消息 `.md-body` 内出现
`[data-text-anchor-mark]` 高亮或 `.fn-mark` 脚注**、分支请求 payload 契约（继承上文 /
kickoff 以真实 user 消息在 messages 里 / `threadChat.anchorText` / 无 system 角色 /
user 消息无指令前缀 / 无空 assistant 消息）、分支内追问二轮流式。走真实模型，
回复内容非确定，断言只卡结构与契约；截图输出到本目录 `shots/`（已 gitignore）。

注：页面已改为「URL 即树身份」——脚本访问 `/thread-chat` 会被 replace 到
`/thread-chat/{uuid}`；每次跑在全新 browser context（干净 localStorage）里新生成
treeId、写入 DB 新行，与既有数据互不污染（本地开发库会积累测试树行，必要时手动清）。

## 持久化验收（openspec: add-branch-tree-persistence）

入库脚本 `verify-persist.mjs`（17 断言，playwright-core + `postgres` 直连 DB 断言，
测试树行跑完自动清理）。前提与 verify-live 相同，另需 `DATABASE_URL` 可连
（`pnpm db:migrate` 已应用 `branch_trees` 表）。运行：

```bash
CHROMIUM_PATH=... BASE_URL=http://localhost:4040 node e2e/thread-chat/verify-persist.mjs
```

断言覆盖三条链（首次实现时另做过 25+4+5 断言的一次性全量验收，见 openspec change）：

- **端到端恢复（25 断言）**：裸路径 replace 到 `/thread-chat/{uuid}`（回退不弹回跳板）→
  主线流式 + 划选开分支 + 回车首答 → 过 1.5s 防抖观测到整树 PUT → 同 context 重载：
  消息 / 分支列（工作台记忆，非只剩主线）/ 锚点高亮脚注全恢复、无 `.typing`/`.caret`
  残留 → **全新 context（无 localStorage）直访同 URL 同样恢复**（URL 即身份的真验证，
  默认布局只开主线，点锚点可打开分支列）→「新对话」跳新 UUID 空树、原 URL 回访原树
  仍在 → DB 行断言（state.threads 含 main+分支、派生标题非空、空树不写库）。
  截图 `shots/persist-restored.png`。
- **sanitize（4 断言）**：node 直接往 `branch_trees` 写含 `streaming` 半截正文 +
  `pending` 空占位的脏快照 → 加载后半截消息以正文显示为 done、空占位被删、无转圈、
  composer 非忙碌（测试行随后清理）。
- **降级（5 断言）**：playwright 拦截 `/api/branch-trees/**` 返回 500 → 页面仍以
  空树打开、console.warn 留痕、真实聊天照常、PUT 失败仅警告不打断。

## 气泡输入框验收（openspec: add-bubble-composer）

入库脚本 `verify-bubble-composer.mjs`（前提同 verify-live；走真实模型，
测试树跑完自动清理）。运行：

```bash
CHROMIUM_PATH=... BASE_URL=http://localhost:4040 \
  node --experimental-strip-types e2e/thread-chat/verify-bubble-composer.mjs
```

断言覆盖（断言面参考 playground verify6 + 本仓 IME / 异步标题关注点）：
划选气泡含输入框（placeholder 提示可留空、弹出即聚焦）→ 按钮文案四态
（默认 / 有输入 / ⌘ 按住 / 列条 override，含优先级与复位）→ Shift+Enter 换行
不提交 → **长问题自增高 + textarea 内滚不自毁气泡（capture scroll 放行修复）、
页面真实滚动仍关气泡（无回归）** → 输入中 Esc 关气泡且无消息入树 →
**CDP IME 组合态（imeSetComposition + keyCode 229 的 Enter）不提交，insertText
上屏后真实 Enter 才提交** → 带问 Enter：新列第 1 条 = 该 user 消息原文、第 2 条
assistant 流式首答、composer 无预填、payload 契约（threadChat.anchorText /
user 原文入 messages）→ 留空 Enter：composer 预填 `kickoffQuestion()` 期望值、
消息区为空、2 秒内无 /api/chat POST → ⌘Enter keepSource：来源列保留、新列开在
紧邻右侧 → **分支首答完成后标题异步变为 ≤8 字语义标题（非锚点截断）、刷新后
仍在（随树持久化）、全程 /api/branch-title 恰好一次**。深树继承段预算的纯函数
用例见上方 prompt-budget.test.mjs。截图 `shots/bc-*.png`。

## 会话列表验收（openspec: add-tree-list-ui）

入库脚本 `verify-tree-list.mjs`（28 断言，前提同 verify-persist；SQL 直插种子树，
测试行 finally 清理——含被用例本身删除的行，重复删除幂等）。运行：

```bash
CHROMIUM_PATH=... BASE_URL=http://localhost:4040 node e2e/thread-chat/verify-tree-list.mjs
```

断言覆盖：空树上 ⌘⇧K 打开弹层（当前树置顶标注「未保存」、种子按 updated_at 降序、
分支数徽标、相对时间、点当前树仅关闭）→ 点击条目切换恢复 → 内联重命名（Esc 取消 /
Enter 乐观提交 + DB `custom_title` 落列）→ **继续聊天触发防抖 PUT 后自定义名不被
派生标题覆盖（双轨标题 design D1 的关键路径）** → 二段删除非当前树（Esc / 点它处
复位确认态、DB 行删除、`thread-chat:ui:{id}` 清理）→ 删除当前树跳转剩余最近一棵
（被删行不被卸载 flush 复活、「最近一棵」指针善后）。开发库可能存有真实树，
断言只卡种子的存在与相对顺序，不假设库里只有测试数据。
