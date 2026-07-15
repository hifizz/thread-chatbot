# 设计：Phase A 气泡输入框

## Context

- 现状：气泡（`branching/selection-bubble.tsx`）只有「开启分支讨论」按钮；`handleFork` fork 空分支后由 `composerPrefillFor` 预填 kickoff、用户回车确认。继承上文一直在 payload（`collectInherited`，verify-live 断言验证）；服务端分支 system 有「结合上文展开」。用户痛点 = 不能带问直开 + kickoff 文案词条化。
- 参考实现：playground 分支 `claude/thread-chat-upgrade-research-joe0d6` commit a9c3cbc（Phase A，净增 ~90 行产品代码），交互已被其 verify6 套件（208 行）验证。两仓已分叉：参考走 store.fork(firstQuestion) + provider 抽象；我们走 chat-controller 发送 + 服务端 system。
- 关键差异带来的简化：我们**不需要** `ForkInput.firstQuestion` ——「带问开分支」= `store.fork()`（空分支）+ `cols.openThread` + `chat.send(threadId, question)`，问题天然成为首条 user 消息并触发流式（fork 数据模型零改动；Message 层的 quote 字段见 D10 实施修订）。

## Goals / Non-Goals

**Goals:**

- 带问开分支一跳直达；留空路径与现状逐项一致（预填流保留）。
- kickoff 文案改为「请结合上下文，展开讲解『X』」（用户定稿）；异步分支标题与继承段预算同批落地。
- 中文输入法下键位不踩坑（IME 守卫）。

**Non-Goals:**

- Phase B 气泡内轻量对话（多轮/升格/徽标）——等 Phase A 真实使用反馈。
- 「留空 Enter 直接把预填文案作为消息发出（跳过确认）」——可选打磨，本次不做，保持「留空 = 可见可改写的确认流」。
- fork/Thread 数据模型的结构性改动（D7 新增 setThreadTitle mutator；D10〔实施修订〕给 Message 增加可选 quote 字段——划选引用消息化，见下）。

## Decisions

### D1：带问路径走 chat.send，不给 store 加 firstQuestion

**选择**：`handleFork(s, hint, question?)`——`question?.trim()` 非空时，fork + openThread 后直接 `chat.send(r.threadId, question)`。

**理由**：我们的发送入口（chat-controller）本来就把文本追加为 user 消息并起流；参考实现的 `ForkInput.firstQuestion` 是因为它的 provider 在 store 层触发首答。走 send 复用全部既有语义（busy/重试/停止/防抖存库/写链）。**弃选**：移植 firstQuestion 字段（多一条 store 路径、多一套测试面，无收益）。〔实施修订〕落地后按 D10（方向 C）给 `send` 增加了可选 `quote` 参数、`Message` 增加了 `quote` 字段——fork 数据模型仍零改动，但「store 与 prompt 层零改动」的原始表述已不成立，以 D10 为准。

### D2：留空路径 = 现有预填流原样保留（共存，不取代）

**理由**：我们的预填流本质是调研文档推荐的「可见代拟首问」的更好变体——可见、可改写、只多一次回车；参考代码自己反而没兑现文档（留空的代拟首问只在发送线上合成、UI 不可见，其文件头注释自认）。两路径首条消息形状一致，下游零分叉。

### D3：键位语义（无 Phase B，Enter 即提交开列）

Enter（无修饰）= 提交（带问/留空同走 `submit()`）；Shift+Enter 换行；⌘Enter = keepSource 提交；Esc = 壳层链关气泡。参考分支 Phase B 落地后把纯 Enter 改成了「轻对话」——我们没有 Phase B，**Enter 直接开列**，与按钮同函数。**IME 守卫必加**（`isComposing || keyCode === 229` 时 return，不 preventDefault）：参考分支没有此处理（未做中文实测），我们在 composer 上刚踩过同一坑（commit 19b8310）。

### D4：先修 scroll 自毁，再加输入框（顺序硬性）

现状 `onScroll = () => onSelChange(null)`（capture 级、无条件）会把 textarea 自增高/内滚产生的 scroll 事件当页面滚动，瞬间关气泡丢输入。**先移植**参考修复（commit e5dc0f9）：事件 target 在 `.sel-bubble` 内则放行。同时输入框 focus 必须 `focus({ preventScroll: true })`（气泡定位刚结算，不能再引发滚动）。

### D5：气泡高度与翻转阈值

输入框使气泡高度增加（textarea 自增高 clamp ~68px），贴底翻转的 clamp 常量（现 extraH 逻辑）随实际高度同步放大，防止底部划选时气泡被裁切。数值以实测截图为准。

### D6：kickoff 文案（用户定稿）

`kickoffQuestion` 换为：「请结合上下文，展开讲解『{X}』」。服务端 system（THREAD_CHAT_BRANCH_*）不动。注意 e2e（verify-live/persist 等）对预填文案有**全等断言**，断言改为从 `kickoffQuestion()` 导入生成期望值（一处定义，文案再变不破测试）。

### D7：异步分支标题

**选择**：新小路由 `POST /api/branch-title`（body：anchorText + 首轮问答摘录）→ `minimaxModel()` 裸模型 `generateText` 出 4–8 字标题（截断兜底）；客户端在分支首答 finish 后触发一次（壳层 effect 或 controller finish 钩子，Set ref 防重），成功走新 store mutator `setThreadTitle(threadId, title)`（原子 + notify），随整树防抖存盘自然持久化；失败 console.warn 静默。**弃选**：复用 /api/chat（整套流式/工具管线杀鸡用牛刀）；在 threadChat 请求里顺带出标题（污染对话流）。与树级 custom_title 无冲突——那是 branch_trees 行的标题，这是树内单个分支节点的标题，层级不同。

### D8：继承段字符预算

**选择**：常量 `INHERITED_CHAR_BUDGET = 6000`（constants/thread-chat.ts）；`buildRequestBody` 组继承段时从**最新往回**累计正文字符，超预算即停（最少保 1 条），被丢弃的最旧段以一条 user 角色说明消息「（更早的 N 条上文已省略）」置于继承段最前。当前会话消息不截（正在进行的对话，截了伤害最大；单会话超长属 v2 摘要话题）。**弃选**：token 精确计数（引 tokenizer 不值，字符近似够用）；模型摘要压缩（每次分支多一跳模型调用，贵慢，v2）。

### D9〔实施修订〕：按钮两态 + 放置提示行（用户定稿）

最初设计的按钮四态文案（override →「开启并替换『X』」等）落地后暴露排版问题：列标题变长撑爆按钮、换行难看。用户定稿改为：**按钮只表达动作**（两态），**放置后果下沉到列条下的 `.place-hint` 单行提示**（超长省略）——默认态也有提示（「默认替换『X』（点小格可换）」），信息更完整。**弃选**：hover tooltip（移动端无 hover，且把关键后果藏进悬停是反模式）。

### D10〔实施修订〕：划选引用消息化（方向 C，用户定稿）

首版 grounding 是发送线代码规则（「分支首条 user 消息拼锚点前缀」）。用户指出本质问题：**「这条提问针对哪段划选」的绑定关系应该是数据,不是代码行为**——否则消息记录不自足,导出/搜索/其他消费者都要各自复刻重建规则。定稿方案：`Message.quote?: { text }` 可选字段,带问开分支时划选原文随首条 user 消息结构化落库；UI 渲染引用回复条（列/画布两视口一致）,正文仍是用户原话；发送线 grounding 改为**字段驱动**（拼法可演进,数据不变）;服务端分支 system 加指代规则一句。**弃选**：前缀直接写进消息文本（气泡显示的不再是用户的话,且措辞永远洗不掉——展示/存储/模型文本三者焊死）。

## Risks / Trade-offs

- **[scroll 自毁]** → D4 前置修复 + e2e 长问题输入断言。
- **[IME]** → D3 守卫 + 复用 composer 修复时的 CDP 组合态验证方法。
- **[气泡裁切]** → D5 阈值调整 + 底部划选截图验证。
- **[e2e 预填断言失配]** → 断言改为 import `kickoffQuestion()` 生成期望值，文案变更不再破测试。

## Migration Plan

纯前端增量，无迁移；回滚 = revert 单 commit。

## Open Questions

（无。）
