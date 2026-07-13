# 设计：会话列表 UI

## Context

- 多树已由 URL 身份成立（add-branch-tree-persistence）：`branch_trees(id, title, state jsonb, created_at, updated_at)`；防抖整树 PUT 会持续用「main 首条 user 消息前 20 字」刷新派生 `title`。空树不写库。
- 页面视觉/交互语言：`.tc` 奶黄纸面 + 墨色；顶栏 `tbtn` 按钮（新对话）；树内已有 ⌘K 切换器（`orchestration/thread-switcher.tsx`，`swx-*` 类：搜索框 + 列表 + 键盘导航的弹层）——树列表弹层沿用这套语言。
- Esc 已有「气泡 → 面板 → 抽屉」逐层关闭链（壳层统一处理）。
- 已拍板：入口 = 顶栏按钮弹层（裸路径「跳最近一棵」不变）；能力 = 切换 + 重命名 + 删除。

## Goals / Non-Goals

**Goals:**

- 看得到所有树、一键切换；改名、删除（含删当前树的善后）；当前树（含未保存态）在列表中可辨识。
- 自定义标题与派生标题互不踩踏。
- 列表接口轻量：不回传任何整树 state。

**Non-Goals:**

- 搜索/过滤、分页（limit 100 兜底）、批量操作、归档、拖拽排序。
- 主聊天页（`/`）侧栏的任何改动。

## Decisions

### D1：`custom_title` 独立列，双轨标题

**选择**：`branch_trees` 加可空列 `custom_title`；PATCH（重命名）只写它；防抖 PUT 照旧只写派生 `title`；展示一律 `coalesce(custom_title, title, '未命名对话')`。

**理由**：这是本变更唯一的数据模型坑——若重命名直接写 `title`，用户改完名一继续聊天，下一次防抖 PUT 就用派生标题把它覆盖了。双列把「机器派生」与「用户意志」分开，两条写路径天然无竞争，PUT 逻辑一行不用改。**弃选**：`title_is_custom boolean` 标志位（PUT 需要读-判-写，upsert 变复杂）；重命名时让客户端记住「别再派生」（状态散落客户端，多端不一致）。

### D2：列表 API 形状——SQL 内派生 threadCount，不回传 state

**选择**：`GET /api/branch-trees` 用一条查询取 `id, coalesce(custom_title, title) as title, updated_at`，`threadCount` 用 `(SELECT count(*) FROM jsonb_object_keys(state->'threads'))` 派生；`ORDER BY updated_at DESC LIMIT 100`。

**理由**：整树 state 可能到百 KB 级，列表回传它是纯浪费；jsonb 键数派生在行数 ≤100 时开销可忽略。**弃选**：加冗余 `thread_count` 列（又一条要维护一致性的写路径，不值）；客户端拉全量 state 自己数（带宽 + 解析都浪费）。

### D3：弹层沿用 swx 交互语言，数据每次打开现拉

**选择**：新组件 `orchestration/tree-list.tsx`，视觉复用 `swx-*` 弹层形态（无搜索框，v1 列表即可）；挂在壳层，打开时 fetch 列表（无缓存/无轮询）；条目 = 展示标题 + 相对时间 + 分支数徽标；当前树高亮置顶，未入库时以本地信息合成一条「未保存」条目。键盘：⌘⇧K 开（⌘K 已被树内切换器占用），Esc 进入现有关闭链最外层（先关它）。

**理由**：与树内切换器同语言，用户零学习成本；列表数据量小、打开频率低，现拉最简单且永远新鲜——缓存/失效是这里最不值得引入的复杂度。**弃选**：常驻侧栏（抢多列工作台横向空间，已拍板否）；SWR/轮询（无共享编辑场景，无意义）。

### D4：删除的善后链

**选择**：删除成功后客户端依次——清 `thread-chat:ui:{id}`；若「最近一棵」指向它则清除；若删的是**当前树**，跳转到列表中剩余最近的一棵，一棵不剩则 `router.replace` 新 UUID。二段确认在条目内完成（删除按钮 → 变「确认删除」，点它处/Esc 复位），不弹全局 modal。

**理由**：孤儿 localStorage 键与悬空「最近一棵」指针是删除必然产生的垃圾，就地收拾；删当前树跳「剩余最近」比跳空树更符合「我在整理会话」的心智。二段确认足以防误触，全局 modal 对一个列表条目操作过重。**弃选**：软删除/回收站（v1 无此需求，schema 不留 deleted_at）。

### D5：重命名交互——内联编辑，乐观更新 + 失败回滚

**选择**：条目悬停出铅笔入口 → 原地变输入框（预填当前展示标题，全选），Enter 提交 / Esc 取消；提交先乐观改本地列表，PATCH 失败回滚并 toast 轻提示（沿用壳层现有 toast）。当前树被重命名后，顶栏/文档标题不需要即时联动（v1 顶栏不显示树名）。

**理由**：列表内改名是高频轻操作，跳弹窗打断心智；乐观更新让手感跟手，失败场景（本地开发几乎不发生）回滚兜底即可。

## Risks / Trade-offs

- **[并发改名与防抖 PUT 同时到达]** → 两者写不同列（D1），DB 层天然无冲突；无需事务/锁。
- **[删除后 404 的悬空 URL（书签/他端仍指向被删树）]** → 访问被删树 = GET `{state:null}` = 以该 id 开新空树——现有语义已优雅兜底，无需额外处理（该 id 只有再次产生内容才会重新入库）。
- **[threadCount 派生在树很大时的开销]** → jsonb_object_keys 只展开顶层键（thread 数，通常个位数），非遍历消息；100 行上限内可忽略。
- **[列表与当前页数据的短暂不一致（防抖窗口内标题/时间略旧）]** → 打开现拉 + 窗口仅 1.5s，接受。

## Migration Plan

1. `pnpm db:generate` 生成 0005 迁移（仅 `ADD COLUMN custom_title text`），`pnpm db:migrate` 应用；纯加列零风险。
2. 回滚 = revert + `ALTER TABLE branch_trees DROP COLUMN custom_title`。

## Open Questions

（无——搜索/分页/归档已明确划出 v1。）
