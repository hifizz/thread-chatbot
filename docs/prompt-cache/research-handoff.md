# Research 交接文档：Thread Chat Prompt 缓存

## 一、需求概述

### 用户场景

Thread Chat 在普通续聊、重新生成、编辑、Fork、联网研究、Markdown Artifact 和 PDF 问答中，会反复把已有上下文发送给模型。目标是在不改变回答语义、工具权限、强制工具行为、推理设置和消息终态的前提下，让供应商尽可能复用完全相同的 Prompt 前缀，降低重复输入计算与成本。

### 功能能力

本项目需要的不是最终回答缓存，也不是自建 Redis Prompt 缓存，而是：

1. 确定性地编译模型输入，消除无意义的前缀漂移；
2. 按真实生成能力划分固定生成模式；
3. 在经过验证的模型线路上启用供应商原生 Prompt 缓存；
4. 持续记录每次调用的缓存读取、写入和未缓存 Token；
5. 缓存未命中、字段缺失或观测失败均不得改变生成行为。

### 验收标准

1. 相同实际 Provider、上游模型、生成模式、Project Contract 和共同历史的请求，在当前 User Message 前产生逐字相同的模型输入前缀。
2. 使用不同 Quote 的兄弟 Fork 完整复用共同祖先历史，差异只从各自当前 User Message 开始。
3. 同一模型线路的第二次相同前缀请求能够返回大于零的缓存读取 Token；不稳定线路允许尽力命中，但必须准确记录每次结果。
4. 固定生成模式内的 System、工具名称和顺序、工具描述和 Schema、首步强制工具、推理设置及最大步骤保持稳定。
5. 缓存参数之外的模型输入和生成参数与未启用缓存时相同。
6. 缓存观测字段缺失时记录为未知，不得记为零命中，也不得使回答失败。

## 二、项目现状与依据

### 当前生成链路

主要链路为：

`run-generation.ts` → `compile-model-context.ts` → `generation-plan.ts` → `streamText()` → 持久化 `providerUsage`

关键现状：

- `lib/thread-chat/streaming/generation-plan.ts` 根据研究路由和 Artifact 请求动态组合 System、工具、首步工具、推理设置和最大步骤。
- `lib/chat/thread-chat-prompt.ts` 当前把 Child 的具体 `anchorText` 放进早期 System。
- `lib/thread-chat/application/compile-model-context.ts` 当前对 Child 继承历史使用 `INHERITED_CHAR_BUDGET=6000`，并可能插入伪 User 省略消息。
- `lib/chat/resolve-attachments.ts` 使用最新 User Query 重新渲染所有历史附件和 Project Files；大 PDF 可能按当前问题重新检索。
- `lib/thread-chat/streaming/run-generation.ts` 已将 AI SDK `LanguageModelUsage` 原样保存为 `providerUsage`。
- AI SDK v7 的 `LanguageModelUsage.inputTokenDetails` 已统一提供 `noCacheTokens`、`cacheReadTokens` 和 `cacheWriteTokens`。

### 已确认的上游约束

- 缓存只能复用逐字相同的输入前缀。
- Anthropic Provider 支持在 System、Message、Message Part 和 Tool 上设置 `cacheControl`，单次请求最多四个缓存断点。
- OpenRouter Provider 支持 Anthropic 模型显式 Prompt 缓存和缓存读取 Token，但本项目当前注册的 OpenRouter 模型没有 Anthropic 模型。
- OpenAI-compatible Provider 能解析上游返回的 `prompt_tokens_details.cached_tokens`，但没有统一的显式缓存断点合同。
- 当前 UMAPIS Claude 线路通过 `@ai-sdk/anthropic` 接入，具备生成标准 `cache_control` 请求的技术路径。

## 三、方案概述

### 端到端路径

`确定实际模型线路` → `确定固定生成模式` → `构造稳定 System 和工具` → `加入 Project Contract` → `加载冻结共同历史` → `标记缓存断点` → `追加当前动态输入` → `调用模型` → `记录缓存观测`

### Prompt 层次

```text
实际 Provider 与上游模型
└─ 固定生成模式
   ├─ 静态 System
   ├─ 固定工具名称、顺序、描述与 Schema
   └─ 固定推理及步骤策略
      └─ Project Contract 版本
         └─ 长上下文检查点（后续阶段）
            └─ 完整冻结的共同历史
               └─ 当前 User Message、Quote 和当前轮 PDF 结果
```

越靠上的内容复用范围越大；Quote、当前问题和当前轮检索结果必须尽量靠后。

## 四、本轮范围

### V1：缓存基础

1. 完成 `add-thread-chat-message-quotes-v2` 中与模型输入和前缀稳定性有关的合同：
   - 具体 Quote 只位于所属 User Message；
   - 从早期 System 移除 `anchorText`；
   - 删除 Child 专属 6000 字符截断和伪省略消息；
   - Fork 使用完整、原序的冻结共同历史。
2. 将 `(researchMode, artifactRequested)` 的合法组合定义为固定生成模式。
3. 每个模式固定以下内容：
   - System 模板；
   - 工具名称、顺序、描述与 Schema；
   - 首步强制工具规则；
   - 推理设置；
   - 最大步骤。
4. 建立 Provider/线路缓存能力表和单一缓存策略入口。
5. 首批显式缓存白名单包含 UMAPIS Claude 的 Opus 5 与 Sonnet 5。
6. 其他 OpenAI-compatible 线路不发送未经验证的显式缓存参数，只被动记录上游返回的自动缓存用量。
7. 使用供应商原生缓存，不引入 Redis、数据库回答缓存或语义缓存。
8. 将缓存字段接入现有 usage、Langfuse 和服务端日志链路。
9. 增加模型输入确定性和缓存参数不改变生成行为的合同测试。

### 不在 V1

- PDF 检索结果冻结及其持久化数据设计；
- 长上下文统一压缩检查点；
- 研究计划后移；
- 跨 Thread、跨 Project 缓存；
- 最终回答缓存或语义缓存；
- 缓存预热；
- 为提高命中率扩大工具权限或统一本来不同的生成模式。

## 五、后续分层

### V2：冻结每轮 PDF 上下文

- 小 PDF 首次使用时冻结实际使用的完整文本版本。
- 大 PDF 的检索页码和片段归属于触发检索的 User Message。
- 重新生成复用原结果；编辑创建新 Message 和新结果；Fork 按 Message ID 继承冻结结果。
- 当前问题不再改写历史 Message 的模型可见内容。

### V3：稳定长上下文检查点

- 完整 Message 历史继续作为事实来源。
- 只有接近模型上下文上限时才创建统一压缩检查点。
- 检查点按有序 Message ID、内容版本和 Prompt 版本生成稳定键。
- Child 复用相同检查点结果，不自行重新摘要。

### V4：高级优化

- 验证研究计划能否在特定 Provider 上安全移到稳定历史之后；
- 评估更多缓存断点、缓存预热和 TTL 策略；
- 建立按模式、模型和线路的成本与质量对照分析。

## 六、关键决策记录

### 决策 1：V1 范围

用户选择：只做 Quote/Fork、固定生成模式、经过验证的 Provider 缓存和基础观测；PDF 冻结留到 V2。

依据：PDF 冻结涉及服务端生成数据的归属、持久化和 DTO 过滤，独立设计风险更低，符合一次迭代只解决一个可独立验收问题的路线图原则。

### 决策 2：Provider 启用策略

用户选择：只对验证通过的线路启用显式缓存。

依据：OpenAI-compatible 不是统一缓存协议；向未知中转站发送猜测参数可能被忽略、拒绝或改变路由。

### 决策 3：Project Contract

用户选择：Project Contract 修改后建立新缓存分区，旧历史在新 Contract 下重新计算，不降低其指令权威。

依据：Project Contract 是服务端长期指令。将它后移虽然可能保存更多历史缓存，但会改变指令层级和生成语义。

### 决策 4：缓存持续观测

用户确认：本轮必须把缓存结果作为持续观测指标，上报到现有 Langfuse/日志链路。

边界：观测指标不能作为控制生成行为的参数。不得根据单次未命中切换模型、改变 Prompt、关闭工具或使回答失败。

### 决策 5：真实模型实验

用户授权使用 UMAPIS Claude Opus 5 和 Sonnet 5 执行付费缓存实验，并额外授权对 Opus 5 再执行 4 至 10 次实验以解释异常。

## 七、缓存模式与分区

### 生成模式

生成模式由真实能力组合决定：

```text
generationMode = (researchMode, artifactRequested)
```

其中 `researchMode` 当前包括：

- `answer`
- `fetch`
- `search`
- `research`

模式身份不应混入以下运行状态：

- 搜索服务是否配置；
- 用户资格；
- 缓存是否命中；
- 缓存是否启用；
- Provider 回退结果；
- 研究路由原因。

这些状态如果实际改变工具或 Prompt，应反映到最终请求特征和观测字段，但不再建立一个混杂状态枚举。

### 缓存分区概念

```text
cachePartition = (
  actualProvider,
  upstreamModel,
  generationMode,
  reasoningConfiguration,
  projectContractVersion,
  promptSchemaVersion
)
```

该标识用于观测和确定性测试，不代表项目自建缓存键。真正的缓存身份由 Provider 根据实际请求内容决定。

## 八、缓存断点建议

Anthropic 最多允许四个断点。完整路线建议：

1. 固定 System 末尾；
2. Project Contract 末尾；
3. 长上下文检查点末尾；
4. 最后一条共同历史 Message 的最后一个可缓存 Part。

V1 不需要一次用满四个断点，建议优先保证：

- **静态配置前缀可缓存：** 固定模式的 System 和工具定义稳定；
- **共同历史可缓存：** 缓存断点位于当前 User Message 之前的最后一条稳定历史末尾。

缓存标记必须由 Provider 策略层注入，不能让通用 Prompt 编译器散落 Anthropic/OpenRouter 专属字段。

## 九、观测指标

### 每次生成必须记录

- 实际 Provider；
- 上游模型；
- 生成模式；
- Prompt Schema 版本；
- Project Contract 版本；
- `inputTokens`；
- `noCacheTokens`；
- `cacheReadTokens`；
- `cacheWriteTokens`；
- `outputTokens`；
- 缓存字段来源和完整性；
- 是否启用了显式缓存；
- 是否发生缓存读取；
- 是否发生缓存写入。

### 聚合指标

主要指标：

```text
Token 缓存命中率 =
cacheReadTokens /
(noCacheTokens + cacheReadTokens + cacheWriteTokens)
```

若 Provider 明细不完整，但 `inputTokens` 和 `cacheReadTokens` 可用，则降级为：

```text
cacheReadTokens / inputTokens
```

同时记录：

- 请求命中率：`cacheReadTokens > 0` 的可观测请求数 / 可观测请求数；
- 缓存写入率：发生缓存写入的请求数 / 可观测请求数；
- 缓存前缀覆盖率：`cacheReadTokens / inputTokens`；
- 未知率：缓存明细缺失的请求数 / 总请求数。

不得把缺失字段转换为零，否则会把“未知”误报成“未命中”。

### 推荐分组维度

- 实际 Provider；
- 上游模型；
- 生成模式；
- Prompt Schema 版本；
- Project Contract 版本；
- 显式缓存是否启用。

## 十、真实实验记录

所有实验均使用合成重复文本，不包含项目文档、用户消息或业务数据。缓存 TTL 均设置为 5 分钟，模型推理关闭，输出限制为 24 Token。

### 实验 0：调用格式校验

初始脚本把 System Message 放入 `messages`，被 AI SDK v7 本地校验拒绝：

```text
AI_InvalidPromptError:
System messages are not allowed in the prompt or messages fields.
Use the instructions option instead.
```

该次未到达 Provider，不产生付费模型调用。修正为顶层 `instructions` 后继续实验。

### 实验 1：Opus 5 与 Sonnet 5 初次验证

稳定前缀约 43,240 输入 Token，其中可缓存前缀为 36,754 Token，未缓存部分为 6,486 Token。

| 模型 | 调用 | cacheReadTokens | cacheWriteTokens | noCacheTokens | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| Claude Opus 5 | 1 | 36,754 | 0 | 6,486 | 命中已有同前缀缓存 |
| Claude Opus 5 | 2 | 0 | 36,754 | 6,486 | 重新写入，顺序异常 |
| Claude Sonnet 5 | 1 | 0 | 36,754 | 6,486 | 写入 |
| Claude Sonnet 5 | 2 | 36,754 | 0 | 6,486 | 命中 |

Sonnet 5 符合预期。Opus 5 出现“先读取、后写入”的反常顺序，说明不能仅凭两次调用判断稳定性。

### 实验 2：Opus 5 初步复核

继续使用相同前缀执行两次：

| 调用 | cacheReadTokens | cacheWriteTokens | noCacheTokens |
| ---: | ---: | ---: | ---: |
| 3 | 36,754 | 0 | 6,486 |
| 4 | 36,754 | 0 | 6,486 |

结果证明 Opus 5 确实可以读取 Prompt 缓存，但还不能解释此前重新写入。

### 实验 3：Opus 5 全新前缀连续 8 次

为排除旧缓存污染，实验生成一个从未发送过的唯一前缀：

```text
experimentId = opus-cache-probe-1788409356790-e63aca4b-c4de-4f32-be03-ec40cfe5f30f
prefixChars = 54,977
```

每次输入共 35,197 Token，其中可缓存前缀 29,917 Token，未缓存部分 5,280 Token。

| 调用 | 耗时 ms | cacheReadTokens | cacheWriteTokens | noCacheTokens | Provider 原始结果 |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 9,369 | 0 | 29,917 | 5,280 | 创建缓存 |
| 2 | 20,011 | 29,917 | 0 | 5,280 | 读取缓存 |
| 3 | 19,735 | 29,917 | 0 | 5,280 | 读取缓存 |
| 4 | 21,670 | 29,917 | 0 | 5,280 | 读取缓存 |
| 5 | 9,021 | 29,917 | 0 | 5,280 | 读取缓存 |
| 6 | 36,909 | 29,917 | 0 | 5,280 | 读取缓存 |
| 7 | 12,269 | 0 | 29,917 | 5,280 | 重新创建缓存 |
| 8 | 3,561 | 0 | 29,917 | 5,280 | 再次创建缓存 |

Provider 原始用量与 AI SDK 标准字段一致，例如：

```json
{
  "input_tokens": 5280,
  "output_tokens": 1,
  "cache_creation_input_tokens": 29917,
  "cache_read_input_tokens": 0
}
```

或：

```json
{
  "input_tokens": 5280,
  "output_tokens": 1,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 29917
}
```

八次均由响应声明 `modelId = claude-opus-5`，但没有返回实际上游节点或缓存分片标识。

### 实验数据解读

- 首次请求正确创建缓存。
- 第 2 至第 6 次连续命中。
- 第 7、8 次在 5 分钟 TTL 内重新写入，因此不是正常过期。
- 后续七次请求中五次命中，请求命中率为 `5 / 7 ≈ 71.4%`。
- 命中请求的缓存前缀覆盖率为 `29,917 / 35,197 ≈ 85.0%`。
- 延迟与命中没有稳定单调关系，不能使用响应耗时推断缓存命中。

### 实验结论

**已验证：**

- UMAPIS 会透传 Anthropic `cache_control`。
- Opus 5 和 Sonnet 5 均能创建并读取 Prompt 缓存。
- UMAPIS 返回的 Anthropic 原始缓存字段可被 AI SDK v7 正确映射。
- Sonnet 5 的两次最小实验表现为标准“先写入、后读取”。
- Opus 5 存在 TTL 内重新创建缓存的情况。

**合理推断：**

- Opus 5 的非稳定命中可能来自 UMAPIS 或其上游的缓存分片、路由节点、缓存亲和性或缓存驱逐策略。

**未知：**

- UMAPIS 没有返回实际上游节点或缓存分片身份，无法从现有响应确定根因。
- 不能保证一次写入后 TTL 内所有请求都命中。

因此 Opus 5 和 Sonnet 5 都可以进入显式缓存白名单，但只能承诺尽力命中，不能承诺确定命中。

## 十一、风险与纠偏

### 风险 1：中转站缓存命中不稳定

发现方式：按模型和时间窗口持续统计请求命中率、写入率及未知率。

纠偏方式：先确认 Prompt 指纹和生成模式是否稳定，再检查实际 Provider 路由；不得因为单次未命中改变生成行为。

### 风险 2：动态内容提前破坏前缀

已知来源：`anchorText`、研究计划、动态 PDF 检索结果、Project Files 当前轮选择结果。

纠偏方式：V1 移除 `anchorText`；研究计划暂留 System；PDF 与长上下文按 V2/V3 独立处理。

### 风险 3：工具定义无意漂移

`routeReason` 当前只进入工具执行闭包，不改变模型可见描述或 Schema。后续修改工具时必须通过请求快照测试确认名称、顺序、描述和 Schema 稳定。

### 风险 4：观测字段缺失造成误判

纠偏方式：使用三态语义——命中、未命中、未知。缺失字段不能填零。

### 风险 5：缓存优化改变语义

禁止：

- 为复用缓存扩大联网或 Artifact 权限；
- 取消本来需要的首步强制工具；
- 改变推理等级或最大步骤；
- 把服务端指令降级成普通 User 内容；
- 恢复滑动字符截断或每轮摘要。

## 十二、Spec 阶段建议

建议从以下顺序启动 Spec：

1. 定义固定生成模式及 Prompt Schema 版本；
2. 定义 Provider 缓存能力表与白名单规则；
3. 定义通用模型消息如何标记“共同历史末尾”，以及 Provider 层如何转换成具体缓存断点；
4. 定义缓存观测字段、三态语义和 Langfuse/日志上报合同；
5. 定义 Quote/Fork 前缀稳定化修改；
6. 定义确定性请求快照测试和 UMAPIS 集成验收测试。

工程师需要重点审查：

- Anthropic 缓存断点是否实际落在当前 User Message 之前；
- 多步工具调用时每一步的 Prompt 和工具集合是否保持模式合同；
- UMAPIS 原始 usage 与 AI SDK 标准 usage 是否同时保留足够排障信息；
- 日志中不得记录完整 Prompt、附件正文、Quote 正文或用户隐私内容。

## 十三、最终范围状态

Research 阶段已经完成以下确认：

- 需求与验收标准已确认；
- V1/V2/V3 范围已确认；
- 三个核心方案决策已由用户选择；
- Opus 5 与 Sonnet 5 的真实缓存能力已验证；
- Opus 5 的不稳定命中已通过额外八次实验复现并记录；
- V1 的实现方向已锁定，可进入 Spec。
