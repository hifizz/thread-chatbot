## Why

`thread-chat` 目前把流式 assistant 回复的组装与整树存盘都交给浏览器；刷新、断网或页面卸载后，服务端虽然会继续消费模型流并完成计费，却没有持久化目标，导致供应商成本已经发生、最终答案却永久丢失。这个问题直接破坏对话产品最基本的可靠性，必须先于实时续流等增强能力修复。

## What Changes

- 为每次 thread-chat assistant 生成建立服务端权威的 generation 记录，绑定登录用户、tree、thread、user message、assistant message 与本次 attempt。
- 为 `branch_trees` 补充所有者并让树与 generation API 都按登录用户隔离；对无法自动归属的历史无主树提供基于原 URL 的一次性认领迁移路径。
- 发送模型请求前增加“持久化屏障”：先确认包含用户消息与 assistant 占位的树快照已成功落库；落库失败时不调用付费模型。
- 让服务端独立消费完整 UI Message Stream；浏览器刷新或网络断开只移除客户端消费者，不中止模型生成、计费和最终持久化。
- 在服务端把正文、Markdown Artifact、联网研究活动、研究路由/计划及错误终态投影为 generation-owned patch；正常完成、明确停止和生成失败都保存可恢复终态。
- 加载分支树时以当前 generation attempt 为权威覆盖浏览器的 pending/partial 快照；正在后台生成时保留忙碌态并轮询终态，完成后自动显示最终答案，但本阶段不恢复 token 级实时流。
- 新增服务端 Stop 语义：只有用户明确停止或重试替换旧 attempt 才请求中止模型；页面卸载不再等价于 Stop。
- 为 generation 完成与计费增加应用级幂等键，防止回调重入、请求重放或重试造成重复扣费及旧 attempt 覆盖新回复。
- 明确处理树删除、重复发送、重试、空回复、服务端超时和陈旧 running 记录，失败时展示可重试终态，不再静默删除消息。

## Capabilities

### New Capabilities

- `thread-chat-generation-persistence`: thread-chat 生成任务的服务端身份、断连继续、最终结果持久化、终态轮询、显式停止及幂等计费契约。

### Modified Capabilities

（无。当前基础 specs 中没有覆盖 branch-tree 生成生命周期的既有 capability；本变更以新 capability 补齐该契约。）

## Impact

- 数据库：新增 branch generation 表、为 `branch_trees` 增加所有者，并为 usage 记录补充应用 generation 幂等标识及必要索引/约束。
- API：扩展 `POST /api/chat` 的 thread-chat 请求身份；新增 generation 状态/停止接口；分支树加载响应增加 generation 摘要与服务端合并结果。
- 服务端：调整 UI Message Stream 的独立消费与完成回调，增加 generation repository、结果投影、状态机与取消观察器。
- 客户端：调整发送前持久化、刷新加载 reconcile、后台终态轮询、Stop/Retry 语义和整树防抖写入规则。
- 计费：保留断连后完整计费，并以应用 generation id 保证一次 attempt 至多扣费一次。
- 不新增 Redis 或其他外部服务；SSE 字节重放、刷新后的实时续流和进程崩溃后的执行恢复留给 P1/P2。
