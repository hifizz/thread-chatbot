## Why

Thread Chat 当前虽然已有 Tavily 搜索代码，但只服务于旧线性聊天的显式「深度研究」模式；默认的 GLM-5.2 Thread Chat 无法主动核验最新框架文档、版本变化或外部事实。先交付一个搜索型 MVP，可以用最少的 provider 调用验证「主动联网是否显著改善编程回答」，同时把成本与失败范围控制在可接受边界内。

## What Changes

- 为 Thread Chat 增加默认开启的 `auto` 搜索策略：GLM-5.2 根据问题的时效性、外部事实依赖和不确定性自行决定是否调用搜索；用户仍可显式选择 `always` 或 `off`。
- 在服务端 system prompt 中注入可信的当前日期、搜索判定规则、来源使用规则和「来源不足就明确说明」的约束；客户端不得覆盖这些规则。
- 新增轻量 `webSearch` 工具契约，MVP 复用已配置的 Tavily provider，改用低成本搜索配置、有限结果和有限正文快照；每轮最多两次搜索，默认目标为一次。
- 将搜索与 `createMarkdownArtifact` 同时接入 Thread Chat 的 AI SDK v7 工具循环，并定义明确的 `activeTools`、`toolChoice`、停止条件和失败降级行为，确保 GLM-5.2 不循环搜索。
- 在流式界面显示搜索开始、查询词、完成/失败和来源链接；最终回答中的时效性事实必须链接到实际返回的来源，不能引用未检索 URL。
- 记录每次搜索 provider 调用、credits/成本、延迟、结果数和触发原因，并按现有微元与利润率口径向用户计费；免费额度也必须计量。
- 建立 GLM-5.2 中英双语编程问题评测集与上线门槛，对比无搜索、自动搜索和强制搜索的正确率、引用质量、延迟、调用数与费用。
- 保留现有显式 Deep Research，不在本批次迁移其 12 步研究流程，也不开放任意 URL 抓取或浏览器自动化。

## Capabilities

### New Capabilities

- `proactive-web-search`：Thread Chat 的主动搜索模式、GLM-5.2 工具决策、调用预算、来源约束与降级行为。
- `web-search-transparency`：搜索过程、来源链接、错误状态和持久化回答的用户可见契约。
- `web-search-metering`：搜索调用的成本计量、用户收费、审计字段和质量/成本评测门槛。

### Modified Capabilities

（无——现有 canonical specs 只有 Markdown 高亮与 Thread Chat 样式，本变更不修改其需求级行为。）

## Impact

- **服务端对话**：`app/api/chat/route.ts`、`lib/chat/thread-chat-prompt.ts`、`constants/thread-chat.ts` 的模式解析、system prompt、工具集合与多步停止条件。
- **搜索 provider**：`lib/ai/search.ts`、`lib/chat/research-tools.ts`、`constants/research.ts` 需要把现有重型 Deep Research 配置与轻量 Auto Search 配置分离。
- **Thread Chat 客户端**：`app/thread-chat/net/prompt.ts`、`app/thread-chat/net/ui-stream.ts`、chat controller、消息/状态类型与搜索状态 UI。
- **计费与数据**：`constants/pricing.ts`、`lib/billing/credits.ts`、Drizzle schema/migration、账单汇总与消息 metadata；搜索调用不能继续成为未收费成本。
- **验证**：新增离线策略评测与带真实 Tavily/GLM-5.2 的受控 live 验证脚本；不引入浏览器 Sandbox。

