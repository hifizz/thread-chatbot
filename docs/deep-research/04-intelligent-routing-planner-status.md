# 智能联网路由与 Research Planner 状态

更新日期：2026-08-18

本文记录第二阶段在 Web Search Demo 基线之上的架构改造、真实验收结果、当前能力边界和后续计划。

## 目标

此前所有模型都能看到联网工具，明确联网请求靠正则强制搜索。这可以验证工具链，却不能回答三个关键问题：

1. 当前请求是否真的需要联网？
2. 如果需要，应直接读取指定网页、简单搜索，还是执行多来源研究？
3. 不同复杂度是否应该使用不同推理强度和工具集合？

本阶段引入显式 Router 和 Planner，使系统从“模型看到工具后自行发挥”变为“先选择执行模式，再最小化暴露工具”。

## 当前架构

```text
用户请求
   │
   ▼
高置信规则路由
   │ 模糊请求
   ▼
当前所选模型的结构化 Router（low reasoning）
   │
   ├── answer   → 不暴露联网工具 → provider-default reasoning
   ├── fetch    → 只暴露 readUrl  → medium reasoning
   ├── search   → webSearch/readUrl → medium reasoning
   └── research → 结构化 Planner   → high reasoning
                                      │
                                      ▼
                               多步 Search/Fetch Executor
                                      │
                                      ▼
                                带来源的最终回答
```

### 决策归属

- 明确、不含歧义的请求先由确定性规则处理，避免额外模型调用。
- 规则无法可靠判断时，由用户当前选择的聊天模型完成结构化分类。
- 用户主动开启 Deep Research 时，直接进入 `research`，不再重复调用 Router。
- Router 只输出模式、原因码、URL 和建议查询，不生成答案，也不保存原始思维链。

## 已完成

### 1. 四态智能路由

| 模式 | 适用场景 | 可用联网工具 | 首步行为 |
| --- | --- | --- | --- |
| `answer` | 稳定知识、解释、写作、已有上下文足够 | 无 | 直接回答 |
| `fetch` | 用户提供 URL，并要求翻译、总结或分析 | `readUrl` | 强制读取 URL |
| `search` | 最新事实、明确要求检索、少量搜索即可回答 | `webSearch`、`readUrl` | 强制搜索 |
| `research` | 多来源调研、复杂比较、交叉核验 | `webSearch`、`readUrl` | 先 Planner，再强制搜索 |

显式“不要联网”优先于其他规则。没有配置 Tavily 时，联网路由会降级为直接回答，并标记 `search_unavailable`。

### 2. 分级推理控制

- Router 使用 `low` reasoning，只完成小型分类任务。
- `answer` 使用供应商默认推理策略。
- `fetch` 和 `search` 使用 `medium` reasoning。
- Planner 和 `research` Executor 使用 `high` reasoning。

这里使用的是模型供应商支持的 reasoning 配置，不向用户展示模型的原始 CoT。

### 3. 结构化 Research Planner

复杂研究会先生成经过 Schema 校验的计划，包括：

- 研究目标；
- 1–8 个子问题；
- 每个子问题的建议查询词、偏好来源类型和是否需要阅读全文；
- 最少独立来源数、是否要求一手来源、是否要求时效性。

该计划作为 Executor 的约束提示，同时通过 UI Message Stream 发送给前端并随消息保存。

### 4. UMAPIS 结构化输出兼容

UMAPIS Opus 4.6 的 Anthropic-compatible Endpoint 可以完成结构化任务，但实测偶尔会忽略 AI SDK 的输出协议，返回 Markdown fenced JSON 或改写字段名。

当前兼容策略：

1. Prompt 明确要求原始 JSON 和固定字段名；
2. 正常路径继续使用 AI SDK `Output.object` 和 Zod 校验；
3. 发生 `NoObjectGeneratedError` 时，只从失败响应中提取 JSON；
4. 兼容 `researchGoal / subQuestions / searchQueries` 等已观察到的字段别名；
5. 恢复后的对象仍必须通过同一份 Zod Schema；
6. 最终仍失败时，降级为单目标安全计划，并记录简短服务端日志。

不会把完整供应商错误对象、响应正文或内部推理写入面向用户的状态。

### 5. 研究计划与活动 UI

- 复杂研究先显示目标和子问题，再显示搜索与阅读步骤。
- 联网活动位于最终回答正文之前，符合当前“工具先执行、正文后生成”的真实顺序。
- `fetch`、`search`、`research` 使用不同面板标题。
- 消息等待态识别计划和联网路由，不再同时显示无意义的三点占位。
- 计划、路由和联网来源随消息持久化，刷新后可以恢复。
- UI 只展示可审计的结构化计划，不展示原始 CoT。

## UMAPIS Opus 4.6 + Tavily 真实验收

### Planner 验收

输入：调研 Claude Code 官方 sandboxing 机制，核验文件系统、网络控制和 permission prompts 的关系。

结果：

- 成功生成 5 个子问题；
- 每个子问题包含 3 条查询词；
- 正确要求至少 3 个独立来源和一手资料；
- 修复后没有进入单目标兜底计划。

### 流式工具链验收

验证链路：

```text
UMAPIS Opus 4.6
  → streamText
  → webSearch
  → Tavily Search
  → readUrl
  → Tavily Extract
  → UI Message Stream
  → 最终带来源回答
```

轻量验收得到 3 个模型步骤、1 次搜索、1 次网页深读，正常收到工具输入、工具结果、正文增量和 `finish` 事件。没有复现此前的 `failed to pipe response` 或 `hasFinished` 错误。

### 效果最大化压力测试

- 6 个模型步骤；
- 6 次 Web Search；
- 5 次 Web Fetch；
- 最终回答约 7,000 字符；
- 总用量约 151,235 tokens；
- 总耗时约 4 分钟。

该结果证明多步研究链路可以工作，也证明当前最大效果参数不适合直接作为默认生产配置。

## 当前限制与风险

1. **首屏等待**：Router 和 Planner 当前在 HTTP 流建立前执行。复杂研究可能先等待十几秒，前端才收到计划事件。
2. **高成本和高延迟**：多轮 Fetch 会把大量网页正文反复带入后续模型步骤。压力测试已达到 15 万级 Token。
3. **Planner 不是严格状态机**：Executor 通过 Prompt 读取计划，但还没有逐项完成状态、证据覆盖检查或强制退出判定。
4. **单 Agent 顺序执行**：多个子问题暂未并行搜索，也没有独立的合并/审校阶段。
5. **来源治理不足**：尚未实现 URL 去重、域名多样性、一手来源优先级评分、时效检查和主张—证据映射。
6. **供应商能力差异**：reasoning、结构化输出和工具流在不同兼容端点上的实现并不完全一致，需要建立模型能力矩阵。
7. **失败恢复有限**：目前有 Schema 兜底，但还缺少每个工具调用的超时、重试退避、部分结果继续回答和供应商 fallback。
8. **安全仍需加固**：需要进一步限制 URL 协议、处理网页 Prompt Injection、设置内容类型/大小策略，并明确外部正文是不可信数据。
9. **不是完整浏览器**：Tavily Extract 不能代替登录态、JavaScript 交互、下载文件、Git clone 或代码仓库级分析。

## 后续实施建议

### Batch B1：可观测性与评测

- 建立固定测试集，覆盖 answer/fetch/search/research 的正确路由率。
- 记录 Router、Planner、每次工具调用和最终综合的耗时、Token 与失败原因。
- 建立来源正确性、引用覆盖率和幻觉率的人工评分模板。
- 为 UMAPIS Opus 4.6、GLM 5.3 等重点模型维护能力矩阵。

### Batch B2：预算与执行控制

- 为四种模式设置不同的步骤、搜索次数、Fetch 数量、正文字符和总 Token 预算。
- 增加查询去重、无新增证据早停和总超时。
- 压缩旧工具结果，避免每一步重复注入完整网页正文。
- 支持在部分来源成功时继续回答，并明确覆盖范围。

### Batch B3：正式 Research Executor

- 将 Planner 子问题变成有状态任务：`pending / searching / reading / covered / blocked`。
- 建立来源账本和主张—证据映射。
- 对独立子问题进行受控并行搜索，再由最终模型统一综合。
- 根据退出条件决定继续研究或停止，而不是只依赖模型自由判断。

### Batch B4：生产安全

- 只接受 `http/https` URL，并增加长度、重定向和内容类型策略。
- 把网页正文明确标记为不可信数据，防止网页中的指令覆盖系统规则。
- 增加域名策略、审计日志、速率限制和供应商错误脱敏。
- 对未来的浏览器/Sandbox 能力单独设计网络、凭据和文件系统隔离。

### Batch B5：交互完善

- HTTP 流尽早建立，立即显示“正在判断是否需要联网/正在规划”。
- 为每个计划子问题展示完成状态和已覆盖来源。
- 提供用户可选的“自动 / 不联网 / 深度研究”控制，但默认仍由系统主动路由。
- 将开发调试信息放入折叠的小字区域，不暴露预算拒绝、参数错误等内部状态。

## 当前结论

第二阶段已经验证了核心方向：由规则和当前模型共同完成智能路由，按模式控制工具和 reasoning，复杂研究使用结构化 Planner，并由 UMAPIS Opus 4.6 + Tavily 完成真实多步研究。

下一阶段不应继续单纯扩大搜索上限，而应优先补齐可观测性、预算控制、证据账本和有状态 Executor。这样才能在保持回答质量的同时，把延迟、成本和失败模式收敛到生产可控范围。
