## Context

新领域链完成后，代码库会暂时同时包含可运行的 legacy ThreadTree 栈和默认关闭的 canonical Conversation 栈。并存代码本身可以支持验证，但生产事实不能并存：任何双写、读失败回退或异步同步都会重新创造 Issue #34 的根因。

Cutover 是一次数据、应用、客户端和文档共同变更，不是简单切 feature flag。本设计把决定门禁、冻结、导入、互斥切换、观察、回滚和最终删除分成可验证阶段。

## Goals / Non-Goals

**目标：**

- 基于真实数据选择重置或导入，并保留审计证据。
- 在没有未确认旧写入时把 canonical 栈切为唯一权威。
- 保持新 specs 定义的全部用户行为、授权和计费正确性。
- 提供切换前后不同的安全回滚策略。
- 删除旧协议和重复领域事实，不留下永久兼容层。

**非目标：**

- 用双写实现无停机迁移。
- 在 cutover 中实现分享、Project assets、CLI/MCP 或 Issue #39 收敛。
- 保留旧客户端的长期写兼容。
- 删除未经依赖审计的其他聊天表或已归档迁移历史。

## Decisions

### D1. Authority 是单值部署状态

应用组合根只接受：

```text
CONVERSATION_AUTHORITY = legacy | canonical
```

服务端健康信息发布 authority、schemaVersion 和 cutover epoch；客户端 boot 必须匹配。`legacy` 组合根不能构造 canonical 写 handler，`canonical` 组合根不能构造 branch-tree 写仓储。配置缺失、未知或两套依赖同时可写时健康检查失败。

备选方案是按请求或 Conversation 灰度双 authority；跨记录的列表、billing job 和客户端路由会产生不可证明的混合边界，因此不用于首次 cutover。

### D2. 数据处置先产出 ADR，再写执行参数

使用 persistence change 的审计器在目标环境输出：

- legacy Conversation/Thread/Message/Generation 数量与所有者分布；
- 合法、需修复、拒绝记录；
- 反馈、Artifact、标题、usage 和其他 sidecar 引用；
- 数据保留义务与环境用途。

单独 ADR 选择：

1. **确定性导入**：存在任何需保留数据时的默认；
2. **受批准重置**：只限明确无保留义务的隔离环境。

任务不会预先写死选择。ADR 包含批准者、时间、范围、备份和不可迁移项处置。

### D3. Legacy 局部 ID 通过持久映射迁移

许多 JSON 内 ID（如 `main`、`m1`、`b2`）只在单棵树内唯一，不能直接成为公开规范 ID。导入器以 `(legacyTreeId, entityType, localId)` 生成或记录稳定 canonical ID，并输出映射清单。所有 ThreadFork、Generation、反馈、Artifact、标题和 usage 引用通过同一映射解析。

导入器使用 upsert/幂等 marker，可在冻结数据上重复 dry-run 和正式运行。单条 Conversation 在事务中导入；全局报告校验源/目标计数、唯一约束、哈希摘要和悬空引用。

### D4. 用短维护窗口代替双写

执行顺序：

```text
拒绝新的 legacy mutations/generations
  → drain/stop/reconcile 非终态 Generation
  → 验证 usage/计费终结
  → 备份 legacy 与空/预导入 canonical 数据
  → 正式 import/reset
  → 全量 integrity verification
  → 切 canonical authority + canonical client
```

维护窗口虽然有短暂不可写，但把最后写入边界变成可证明时刻。双写看似减少停机，却需要再次实现两套语义的协调，风险更高。

### D5. 行为矩阵是 release gate，不是人工印象

矩阵至少覆盖：

```text
Auth/owner/project isolation
Conversation list/create/title/archive/restore/delete
Thread title/archive/restore
Column/tree-list/canvas navigation
Selection anchor + A→B→C Fork
Send/edit/regenerate/select variant
Markdown/Artifact/research activities
Copy/feedback/message actions
Streaming/disconnect/Stop/stale recovery/refresh
Usage completeness/exactly-once billing
遗留路由拒绝
```

每项关联自动测试、手工 smoke（仅视觉交互）和新 spec Requirement。已确认旧错误不作为“兼容行为”保留。

### D6. 切换采用一个不可分割的 release checkpoint

在数据验证完成且仍处于维护模式时：

1. 部署/启用 canonical 服务端 authority；
2. 验证规范 API 健康、schema 和 epoch；
3. 启用 canonical 客户端 build；
4. 对内部 canary actor 执行读写 smoke；
5. 开放流量并关闭维护模式。

如果平台不能原子切配置与客户端，则先部署能识别服务端 epoch 的客户端壳，只有 epoch 匹配才加载 canonical 页面；不允许新客户端向 legacy 写入或旧客户端向 canonical 写入。

### D7. 旧路由立即拒绝，代码和表延后删除

切换时旧 mutation routes 返回 `410` + `legacy_protocol_retired`（认证/不可见检查仍按安全策略执行），旧读取不作为 canonical fallback。保留最小拒绝/遥测 handler 一段声明观察期，用于识别陈旧客户端。

观察门禁通过后分两步清理：

1. 删除 Tree Store、`persistNow`、reconcile、legacy repositories/routes 和所有新代码对 ThreadTree 类型的导入；
2. 在备份保留与依赖扫描通过后，用后续不可逆迁移删除确认只服务旧能力的表/列。

历史 SQL migration 文件不重写。名称相似的 assistant-ui 线性表先审计用途，不能因为名字相似顺带删除。

### D8. 可观测性围绕正确性门禁

Dashboard/日志至少包含：

- authority/schema/epoch mismatch；
- snapshot/command 成功率与稳定错误码；
- revision/idempotency 冲突；
- Generation 非终态年龄、checkpoint age、Stop latency、stale 收敛；
- `usage_unavailable`、唯一 usage 冲突和对账差异；
- legacy route 调用；
- 导入/运行时外键和不变量失败。

阈值在 release runbook 中依据当前基线填写，不在设计中伪造通用数字。日志只记录 ID、分类和计数，不记录私密 Message 正文。

### D9. 回滚线以首个 canonical 生产写入为界

**切换前：** legacy 数据未改变，可退出维护并继续 legacy。

**切换后但尚无 canonical 写入：** 可以关闭流量并回到 legacy，但必须用审计证明零 canonical mutation。

**已有 canonical 写入：** legacy 已成为落后备份，不得恢复为权威。选择：

- 回滚客户端/应用版本，但保留兼容 canonical schema；
- 进入 canonical read-only 并前滚修复；
- 从 cutover 后的规范备份/事务日志恢复。

绝不实现 canonical → ThreadTree 反向同步，因为它会把删除掉的重复关系语义重新引入。

### D10. OpenSpec 按“历史实现 → 目标替代”排序

对依赖旧模型的 changes 建立 supersession 清单。完成的旧 changes 保留真实历史；归档时确保最终生效 specs 由 `define-conversation-domain-model` 和四个后续能力覆盖。未完成 `persist-thread-chat-generations` 不补勾任务，记录被 `migrate-generation-lifecycle` 及 cutover 替代的原因和未完成范围。

若归档工具会把旧 requirement 重新合并为目标权威，则使用明确的 superseded/skip-specs 历史处置流程，而不是通过修改旧任务伪造一致性。

## Risks / Trade-offs

- **[风险] 维护窗口暂时阻止聊天写入。** → 提前测量导入时间、预生成 dry-run 映射并保留只读访问；用短冻结换取唯一写入边界。
- **[风险] 遗留污染数据阻塞整批切换。** → 按 Conversation 事务导入并提前修复；所有排除都需 ADR 批准和备份。
- **[风险] 新客户端与 authority epoch 不匹配。** → boot 强制检查服务端 epoch/schema，不匹配时显示维护/刷新提示而不写入。
- **[风险] 切换后无法简单回到旧 JSON。** → 这是避免数据丢失的必要限制；通过 canonical 备份、read-only 和前滚演练降低风险。
- **[风险] 过早删表破坏隐蔽 job。** → 先拒绝路由和删除代码引用，观察零调用，再以 DB dependency/query audit 门禁物理删除。

## Migration Plan

1. 完成并严格验收全部前置 changes，建立行为矩阵和基线。
2. 在目标环境运行只读审计，批准 import/reset ADR，完成 dry-run 与映射报告。
3. 演练维护、drain、备份、导入、验证、切换和 canonical 恢复。
4. 正式进入维护窗口，冻结旧写入并收敛所有 Generation/计费。
5. 生成验证备份，执行 import/reset 和全量完整性检查。
6. 切换 authority/client epoch，执行 canary 和 smoke 后开放流量。
7. 观察门禁通过后删除旧运行时代码；保留备份至声明期限。
8. 依赖扫描和恢复验证通过后删除遗留表/列，并如实处置旧 OpenSpec changes。

## Open Questions

仅有一个必须由真实审计回答的部署决策：目标环境采用确定性导入还是受批准重置。该问题不改变架构，但必须在执行 cutover 前以 ADR 关闭。
