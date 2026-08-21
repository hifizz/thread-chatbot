## Why

前四个 changes 可以把新模型完整实现出来，但只要 `branch_trees.state`、整树 PUT 或旧客户端仍能写入，系统就有两个事实源，任何新关系和修复最终都会再次漂移。最后必须通过有证据、可门禁、不可双写的 cutover，把规范 Conversation 栈切为唯一生产权威，并让旧 ThreadTree 协议和代码安全退场。

## What Changes

- 汇总遗留审计、真实数据量、悬空引用和功能覆盖证据，在 cutover 前明确选择“一次性导入”或“有批准的数据重置”，不得在任务中预设答案。
- 建立旧/新行为对照与发布门禁，覆盖列表/标题、列/画布、嵌套 Fork、Message 变体/actions、Artifact/反馈、Generation Stop/恢复和计费。
- 在维护窗口停止旧写入、排空或收敛非终态 Generation、生成可验证备份，并一次性导入/初始化规范实体及所有辅助引用。
- 以互斥 authority 配置原子切换规范服务端、命令 API 和 normalized 客户端；系统不存在长期双写、双读择优或后台协调模式。
- **BREAKING**：关闭整树 GET/PUT/DELETE 写协议、遗留 Generation 协调路由和浏览器 save/reconcile 路径；旧客户端收到稳定 retired 响应，不得继续覆盖规范实体。
- 在观察期后删除 `ThreadTreeState` 新代码依赖、魔法 `main`、重复 parent/children/forks/depth/activeLeaf 字段，以及确认无其他用途的 `branch_trees`/`branch_generations` 结构。
- 制定不会把规范写入回灌旧 JSON 的回滚方案；切换后问题通过 canonical read-only、前滚修复或规范备份恢复处理。
- 处理依赖旧权威模型的活跃 OpenSpec changes：完整能力保留为历史，未完成的 `persist-thread-chat-generations` 明确标记被新链替代，不把未完成任务伪装为完成。

## Capabilities

### New Capabilities

- `conversation-cutover`：定义从 ThreadTree 权威到规范 Conversation 权威的数据决策、发布门禁、互斥切换、旧协议退场、观察与回滚要求。

### Modified Capabilities

- 无。遗留 capabilities 的历史归档顺序由本 change 的迁移任务处理；目标行为由新链的独立 capabilities 定义。

## Impact

- 数据：`branch_trees`、`branch_generations`、Message feedback、Artifact/标题/usage 外键、规范 Conversation 全表和备份。
- 服务端：旧 branch-tree 路由、Generation sidecar/reconcile、领域 types/selectors/repositories、authority 配置和运维脚本。
- 客户端：legacy boot/Store/persistence/chat controller 与 canonical 页面开关。
- 发布：维护窗口、数据审计、canary/smoke、指标、回滚和旧表保留期。
- OpenSpec：旧 active changes 的历史处置与新 changes 的依赖顺序。
- 前置依赖：`define-conversation-domain-model`、`normalize-conversation-persistence`、`migrate-generation-lifecycle`、`add-conversation-command-api`、`normalize-conversation-client-state` 全部实现并验收。
