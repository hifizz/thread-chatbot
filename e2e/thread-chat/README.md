# thread-chat e2e 验收脚本

`/thread-chat`（分支对话页）的两套验收脚本，均无需测试框架。

## anchor-ranges.test.mjs — 锚点定位纯函数用例（无需 dev server）

```bash
node --experimental-strip-types e2e/thread-chat/anchor-ranges.test.mjs
```

覆盖 `app/thread-chat/branching/anchor-ranges.ts` 的 TextQuoteSelector 式定位：
重复短语按 prefix/suffix 上下文选中正确出现（含指向第 2 次出现的核心用例）、
无上下文回退顺延、全零分回退、占坑去重、截短上下文的部分匹配得分。

## verify-live.mjs — 真实后端端到端验收

前提：dev server 已在 3000 端口（`pnpm dev`）、`.env.local` 配好 MiniMax key、本机有 Chromium。

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e/thread-chat/verify-live.mjs
```

断言覆盖（15 项）：页面加载、主线真实流式回复、划选开分支气泡、分支流式首答、
主线锚点脚注出现、分支请求 payload 契约（继承上文 / kickoff 代拟首问 /
`threadChat.anchorText` / 无 system 角色 / user 消息无指令前缀 / 无空 assistant 消息）、
分支内追问二轮流式。走真实模型，回复内容非确定，断言只卡结构与契约；
截图输出到本目录 `shots/`（已 gitignore）。
