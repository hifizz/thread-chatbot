# Phase A：划选气泡内输入框（fork 首条消息策略收口）

## Why

用户划选开分支时有两个真实痛点（用户点名）：① 气泡里没有输入框——想带着自己的问题开分支，得先开空分支再改写预填文案，多一跳；② 分支首答的代拟问题「请围绕我划选的这段话展开讲解…先解释它本身的含义…」偏百科词条式、缺「衔接上文继续分析」的暗示，模型容易答成孤立词条（继承上文本身在 payload 里，经 verify-live 断言长期验证——问题在问法不在链路）。参考分支（playground `claude/thread-chat-upgrade-research-joe0d6`，commit a9c3cbc）已验证过这套交互，本变更按我们的架构（chat-controller 发送、服务端 system、composer 预填流）落地。

## What Changes

- **气泡加可选输入框**（单行 textarea 自增高）：**输入后提交 = 带问开分支**——问题直接成为新分支第一条 user 消息并触发流式首答（fork 后走 `chat.send`，store 无需新字段）；**留空提交 = 现有预填流原样保留**（空分支 + composer 预填 + 回车确认）。
- **键位**：Enter 提交、Shift+Enter 换行、⌘Enter 提交且保留来源列（keepSource）、Esc 走壳层关闭链；**IME `isComposing`/keyCode 229 守卫**（参考分支没有、我们必须有——与 composer 同一课）。
- **按钮文案随态切换**：列条 override →「开启并替换『X』」；⌘ 按住 →「在右侧新列打开」；有输入 →「带着问题开分支」；默认 →「开启分支讨论」。
- **前置修复（必须先做）**：气泡的 capture 级 scroll 监听会把 textarea 自增高/内滚当成页面滚动、瞬间自毁气泡丢输入——移植参考分支的「事件 target 在 `.sel-bubble` 内则放行」修复。
- **kickoff 预填文案更新**（用户定稿）：「请结合上下文，展开讲解『{X}』」——短、直接、衔接上文的意图放在句首。
- **异步分支标题**：分支标题现为锚点截 13 字；首答完成后异步让模型生成 4–8 字标题替换（失败静默保留默认），随整树防抖存库持久化。
- **继承段上下文预算**：`buildRequestBody` 的继承段设字符总预算（常量 ~6000），以完整消息为单位从最旧丢弃（保底最近 1 条），发生丢弃时在继承段最前插入省略说明消息——深树不再上下文爆炸。当前会话消息 v1 不截。
- 范围**不含**：Phase B 气泡内轻量对话（多轮轻问答/升格/徽标——等 Phase A 真实使用反馈）、气泡内发送后的任何新视口形态（提交后必开完整分支列）。

## Capabilities

### New Capabilities

- `bubble-composer`: 划选气泡内的可选输入框——两条提交路径的消息形状、键位语义、按钮文案态、scroll 自毁修复、IME 守卫；以及同批的分支体验件：异步分支标题、继承段上下文预算。

### Modified Capabilities

（无既有 spec 涉及此交互面。）

## Impact

- `app/thread-chat/branching/selection-bubble.tsx`（输入框 + 键位 + 文案态 + scroll 放行，~80–100 行）
- `app/thread-chat/thread-chat-demo.tsx`（`handleFork` 加可选 `question` 参数：有问则 fork 后 `chat.send`，~15 行）
- `app/thread-chat/net/prompt.ts`（kickoff 文案 + 继承段预算截断，~35 行）
- `app/thread-chat/core/store.ts`（新 mutator `setThreadTitle`，~10 行）
- 新增小路由 `app/api/branch-title/route.ts`（4–8 字标题生成，用 `lib/ai/minimax.ts` 的裸模型 `minimaxModel`，照主聊天 generateTitle 先例）+ `net/persist.ts` 或 net/ 客户端函数（~40 行）
- `app/thread-chat/thread-chat.css`（输入区样式 + 气泡贴底翻转阈值随高度调整，~20 行）
- `e2e/thread-chat/verify-bubble-composer.mjs`（新入库脚本，断言面参考 playground verify6）
- **不改**：fork 数据模型（无 firstQuestion 字段——发送走 chat-controller 天然成为首条 user 消息）、/api/chat、锚点/持久化机制（标题变更随整树存盘自然持久化）。
