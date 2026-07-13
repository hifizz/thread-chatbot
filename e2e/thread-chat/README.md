# thread-chat e2e 验收脚本

`/thread-chat`（分支对话页）的两套验收脚本，均无需测试框架。

## text-anchor.test.mjs — 锚点定位纯函数用例（无需 dev server）

```bash
node --experimental-strip-types e2e/thread-chat/text-anchor.test.mjs
```

覆盖 `app/thread-chat/branching/text-anchor.ts` 纯字符串层的三层降级定位
（position → exact → fuzzy）：position 直接命中、exact 多处命中经 prefix/suffix
上下文消歧、**fuzzy 原文被改几个字后仍以 score≥阈值 命中正确区间**、
阈值抬高 / 彻底无关锚点判定丢失（返回 null）、fuzzySubstring 单字错漏容忍。

## verify-live.mjs — 真实后端端到端验收

前提：dev server 已在 3000 端口（`pnpm dev`）、`.env.local` 配好 MiniMax key、本机有 Chromium。

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e/thread-chat/verify-live.mjs
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
