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
