# 设计：分支对话树 DB 持久化

## Context

- `app/thread-chat/` 的会话真相源是自研 headless store（`core/store.ts`）：`createThreadStore(seed: ThreadTreeState)` 以种子创建，`getState()/getVersion()/subscribe()` 对外；内部**原地修改 + version 递增**。`ThreadTreeState` 是纯 JSON（设计原则 P10 专为持久化留的路）。
- 页面接入点：`thread-chat-demo.tsx` 中 `useState(() => createThreadStore(emptySeedState()))`——把 `emptySeedState()` 换成已存状态即完成「恢复」，store 零改动。
- 仓库已有完整 Drizzle + Postgres 基建：`lib/db/index.ts`（全局单例客户端）、`lib/db/schema.ts`、`drizzle/` 迁移、`pnpm db:generate|migrate`。主聊天页的 `threads`/`messages` 表是 assistant-ui 线性模型（parentId 链），语义与树形分支态不同。
- **工作树现状**：`branchTrees` 表的 schema 改动与迁移文件 `drizzle/0004_dear_wolfsbane.sql` 已生成（上次被打断的实现残留，与本设计一致），**未应用到 DB、未提交**。实现阶段直接复用：先 `pnpm db:migrate` 应用，不要重复 generate。
- 划选锚点（`Fork.anchor: TextAnchor`）是消息数据的一部分，随整树 JSON 一起存取，恢复后由现有渲染 effect 重绘——持久化层对锚点无感知。

## Goals / Non-Goals

**Goals:**

- 刷新/重进页面后整棵分支树（消息、分支、锚点、Artifact 登记、计数器）完整恢复。
- 对现有代码的侵入最小：store、锚点、分支、markdown、滚动、平滑一律不改。
- 流式期间不产生写风暴（防抖合并）。
- DB 不可用时页面照常可用（仅不持久化），不白屏不阻塞。

**Non-Goals:**

- 多会话列表（新建/切换/删除/重命名多棵树）——schema 已天然支持（一树一行），本次不做 UI 与路由。
- 跨设备同步、用户体系、鉴权（treeId 即知即写，本地开发产品阶段可接受）。
- 增量/按消息持久化（整树 JSON 足够小；见风险节的量化）。
- 主聊天页持久化栈的任何改动。

## Decisions

### D1：整树 JSON 一行，而非规范化多表

**选择**：新表 `branch_trees(id text pk, title text, state jsonb not null, created_at, updated_at)`，`state` 存完整 `ThreadTreeState`。

**理由**：store 的数据模型本就是一个可整体序列化的 JSON 文档，整树存取 = `JSON.stringify(getState())` / `createThreadStore(loaded)`，两行代码闭环；规范化成 thread/message 多表需要拆装映射、事务写多行、恢复时重组树，全是纯开销——本产品没有「跨树查询消息」的需求来支付这些成本。锚点（TextAnchor）、脚注计数器、Artifact 登记这些「杂项状态」在 JSON 方案里免费获得持久化，规范化方案里每个都要单独建模。

**弃选**：复用/扩展现有 `threads`/`messages` 表——两者 parentId 语义不同（消息链 vs 树形分支），混用会让两套持久化互相牵制；且 assistant-ui 的 format 版本化字段与我们无关。

### D2：URL 即树身份（`/thread-chat/[treeId]`），localStorage 只记「最近一棵」

**选择**：新增动态路由 `app/thread-chat/[treeId]/page.tsx`（server component `await params` 后把 treeId 传给客户端 loader，签名照 `app/api/threads/[threadId]/route.ts` 的 Promise params 惯例）。裸路径 `/thread-chat` 变成入口跳板：客户端 effect 读 localStorage `thread-chat:last-tree-id`，有则 `router.replace(/thread-chat/{id})`，无则生成 UUID 后 replace（replace 不留历史，回退键不会弹回跳板）。loader 每次成功加载后把当前 treeId 写回 localStorage 作「最近一棵」。顶栏加「新对话」按钮 = 跳转到新 UUID。

**理由**：URL 是 web 原生的多会话形态——换 URL 即换树、书签/历史即会话列表、直接访问新 UUID 即开新树，以「一个动态路由 + 一次 replace」的成本拿到多树能力，列表 UI（枚举/删除/重命名）留作纯增强。treeId 在 URL 里对首屏可见，也让持久化 e2e 能在**全新无 localStorage 的 context** 里用同一 URL 验证恢复（这才是身份方案的真验证）。localStorage 职责两层（见 D7）：全局一条「最近一棵」（裸路径跳转目标）+ **按 treeId 分键的每棵树工作台状态**。key 与防抖毫秒等常量进 `constants/thread-chat.ts`。localStorage 只在客户端 effect 里碰，避免 SSR/hydration 问题。

**弃选**：仅 localStorage 身份（原方案）——多树要靠清 localStorage，不可分享不可书签；查询参数 `?tree=`——语义上树是资源不是过滤器，且动态段与现有 API 路由风格一致。

**安全阀**：路由与 API 对 treeId 做 UUID 形状校验（不合法 404/400），避免任意字符串打到 DB 主键。

### D3：先加载后挂载（loader + inner 拆分）

**选择**：现组件改名 `ThreadChatDemoInner`，新增 props `initialState`/`treeId`；新的默认导出是 loader——挂载后 `getTreeId() → loadTree(id) → sanitize → setSeed`，加载完才渲染 inner。加载中渲染 `.tc` 风格的一行轻量占位。

**理由**：store 以 `useState(() => createThreadStore(seed))` 一次性创建，「先建空树再水合」需要给 store 加 replace/hydrate 能力（改 core，违背最小侵入），或重建 store 强制 remount（与列编排状态互相打架）。先加载后挂载让 inner 的全部内部逻辑（编排/放置/画布/⌘K/controller 生命周期）零改动。加载通常 <100ms（本地 DB 单行读），占位一闪而过。

**弃选**：SSR 预取（页面是 `"use client"` 重交互 demo，引入 RSC 数据管道不值）；乐观先渲染空树再替换（remount 闪烁 + controller abort 时序复杂化）。

### D4：防抖 1.5s 整树 upsert + 卸载 flush

**选择**：inner 里已有 `useThreadStore(store)` 订阅 version；effect 监听 version 变化，重置 1.5s 定时器，到点 `saveTree(treeId, store.getState(), title)`。卸载时若有 pending 定时器则立即 flush 一次（尽力而为）。首屏 version 未变不写。title 派生：main 首条 user 消息前 ~20 字，无则「未命名对话」。

**理由**：流式期间 version 每帧递增（rAF 合帧），1.5s 防抖天然把整场流式合并成结束后一次写；用户手动操作（开分支/发消息）也各自合并。整树 PUT 幂等，丢一次中间写只损失 1.5s 内的变更，可接受。**不用** `beforeunload`+`sendBeacon` 做关标签页兜底：v1 接受「最后 1.5s 变更在强杀标签页时可能丢」，换取实现简单（React 卸载 flush 已覆盖路由离开场景）；若实测觉得丢得肉痛再补 sendBeacon（PUT JSON 对 Beacon 不友好，需要单独 POST 端点，先不引入）。

### D5：加载期 sanitize 收敛非终态消息

**选择**：`sanitizeLoadedState(state)`——遍历所有 thread 的 messages，assistant 且 status ∈ {pending, streaming}：有正文 → 置 `done`；空正文 → 删除该条。加载期一次性处理，纯函数。

**理由**：防抖可能恰好在流式中途落盘；AbortController 不跨页面存活，重载后没有任何东西会把这些消息推进到终态——不收敛就是永远转圈的僵尸气泡。「有正文置 done」与现有停止按钮的语义一致（保留已收文本完成）；「空占位删除」与重试语义一致（用户可重新发问）。

### D7：每棵树的工作台状态按 treeId 记在 localStorage

**选择**：localStorage 按树分键 `thread-chat:ui:{treeId}`，存该树的**工作台状态**：`{ slots（打开的列及折叠态）, widths（列宽映射）, forceCols, mode（放置策略）, viewMode（列/画布） }`。变化时轻防抖写入（~300ms，纯本地写很便宜）；loader 加载树数据后一并读出，**先校验**（slots 里引用的 threadId 必须存在于加载回来的树中，失配的过滤掉；全空则回默认「只开主线」），再作为 Inner 的初始 UI 状态传入。`useColumnSlots` 增加可选的初始 slots/widths 入参（默认维持现状），`forceCols/mode/viewMode` 的 useState 用传入初值。

**理由**：会话数据（DB）恢复了但列布局全部重置回只剩主线，对多列工作流的用户等于「每次重开都要手动重摆工作台」——布局记忆是恢复体验的另一半。放 localStorage 而非 DB 的理由：列宽/列数与**当前设备的视口**强相关（跨设备同步布局反而错）；这层是高频易变的 UI 态，不值得走网络与防抖存库通道；且它丢了无伤（数据都在，重摆即可），与 DB 里的对话数据风险等级不同。按 treeId 分键即「记住每棵树的不同情况」——树 A 开着三列、树 B 只看画布，各自独立恢复。

**弃选**：把 UI 状态并进 ThreadTreeState 存 DB——污染纯对话数据模型（core 零 React/零 UI 的纪律），且跨设备布局同步是负资产；只存全局一份 UI 状态——切树互相踩，正是本决策要修的问题。

### D6：API 形状——GET 未命中返回 200 + `{state:null}`

**选择**：未命中不是 404。**理由**：首次访问是正常路径不是错误；客户端一个分支判断即可，无需在 fetch 层区分「404 = 正常」与「404 = 路由不存在」。PUT 用 drizzle `onConflictDoUpdate` upsert；body 校验只做「state 存在且为对象」的浅校验（服务端不理解 ThreadTreeState 语义，深校验属于过度设计；治理输入体积交给 Next 默认 body 限制）。

## Risks / Trade-offs

- **[写放大：整树 JSON 每次全量 PUT]** → 量化：百条消息、每条 1-2KB 级别，整树 <1MB，1.5s 防抖下写频率极低（人类对话节奏），本地/单实例 Postgres 毫无压力。真到长对话再考虑压缩或增量，不预支复杂度。
- **[并发覆盖：同 treeId 多标签页同时写，后写覆盖先写]** → v1 接受（单人本地产品，且防抖窗口内两个标签页同时活跃编辑同一棵树的概率极低）。不引入乐观锁/version 列；schema 里 `updated_at` 已够未来诊断。
- **[防抖窗口丢失：强杀标签页丢最后 ≤1.5s 变更]** → 接受（见 D4 弃选理由）；卸载 flush 覆盖正常离开路径。
- **[脏快照：流式中途落盘的半截消息]** → D5 sanitize 在加载侧收敛,写入侧不做特殊处理（写入侧拦截会让「防抖到点但正在流式」变成复杂的延迟队列，不值）。
- **[localStorage 被清：丢「最近一棵」指针]** → 影响已被 D2 大幅缩小：树的权威身份在 URL，书签/历史/重访同一 URL 都能找回；丢的只是裸路径 `/thread-chat` 的默认跳转目标（会开新树）。未来列表 UI（从 DB 枚举）彻底解决发现性。
- **[e2e 相互污染：verify-live 与持久化]** → verify-live 每次跑在全新 browser context（干净 localStorage），treeId 新生成、写入新行，互不影响；需在实现验收中确认这一点，并留意 DB 里会积累测试树行（本地开发库，可接受，必要时手动清）。

## Migration Plan

1. 复用工作树已有的 schema 改动 + `drizzle/0004_dear_wolfsbane.sql`，`pnpm db:migrate` 应用（纯新增表，零风险，不触碰现有表）。
2. 代码合入后即生效；回滚 = revert 提交 + `DROP TABLE branch_trees`（无外键无依赖）。
3. 无数据回填（此前无持久化数据）。

## Open Questions

（无——范围内的决策已全部定案；多会话列表、sendBeacon 兜底、乐观锁均已明确划出 v1 之外。）
