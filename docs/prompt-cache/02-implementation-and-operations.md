# Thread Chat Prompt Cache 实施与运维说明

> 本文对应 OpenSpec change：`optimize-thread-chat-prompt-cache`。  
> 基准：`codex/feat-agent-observability-evaluation@2f3024747ddb72e1e69aa916cb45addb7140f6ab`。  
> 第一阶段使用 Fake Provider/Usage 完成可重复验证；没有真实 Provider 凭据时，不宣称线上 Claude 已命中缓存。

## 1. 我们最终优化的是什么

Prompt Cache 复用的是模型已经处理过的**相同输入前缀**，不是旧答案，也不是数据库里的 Message ID。

旧请求近似为：

```text
动态工具
System = 通用规则 + 具体 anchorText + 本轮 Research Plan
A 的共同历史
B1
```

不同分支的 `anchorText` 在共同历史之前出现，导致缓存很早分叉。

新请求为：

```text
稳定 Tool Profile
稳定 Agent Kernel
可选 Project Contract
A 的冻结祖先历史
B 已完成的历史
---------------- 缓存边界 ----------------
本轮 Runtime Control
当前用户：Quote × 0..50 + Text? + File*
```

具体引用第一次出现在当前用户 Message 中。兄弟分支因此可以共享到 A 的历史末尾；同一分支继续聊天时，可以继续共享已经完成的 B 历史。

## 2. 系统化做缓存的四步方法

以后任何新上下文元素进入模型前，都要回答四个问题：

1. **模型需要看到吗？**  
   不需要看到的 ID、标题、脚注、TextAnchor、列位置、Trace ID 完全不进 Prompt。
2. **多久变化一次？**  
   长期不变的规则放稳定前缀；每轮变化的计划、记忆、附件和问题放动态尾部。
3. **变化后应局部失效还是主动分区？**  
   模型、工具权限、Project Contract、序列化版本变化时，主动进入新的缓存空间。
4. **如何证明省钱？**  
   同时记录 cache read/write、未缓存输入、输出、Gateway/Relay 费用、TTFT 与质量分数。

这四步由 `CacheStability`、Prompt Segment、版本、Hash、Route Capability、Trace 和 Agent Eval 一起实现。

## 3. Quote 数据与缓存的关系

### 3.1 一条用户 Message 支持多引用

```text
Quote Part × 0..50
Text Part × 0..1
File Part × 0..20
```

每份 Quote 保存：

- 服务端生成的 Quote ID；
- 冻结引用正文；
- 可选逐条 comment；
- 来源 Project、Thread、Message 或 Artifact；
- DOM 无关的 TextAnchor。

模型只收到引用正文和 comment。以下数据永远不送模：

```text
quoteId / kind
Project / Thread / Message / Artifact ID
TextAnchor
标题 / 脚注 / 列位置
Draft / Command / Request / Trace ID
```

因此，产品导航元信息发生变化不会改变 Token，也不会破坏缓存。

### 3.2 v1 的引用范围

普通 Quote 只允许来自目标 Composer 所属的当前 Thread：

- 当前 Thread 的 `completed` assistant Message；
- 当前 Thread 中由 `completed` assistant Message 生成的 Markdown Artifact。

明确拒绝：

```text
其他 Thread / 其他分栏 / @Thread / 跨 Project
generating / stopped / failed assistant Message
```

Fork 第一轮的父 Thread 来源是唯一例外；它由服务端根据 Fork 拓扑自动生成 `branch-origin` Quote，客户端不能伪造。

### 3.3 空问题开分支

用户划选后不输入问题：

```text
只创建 ForkedThread
不创建 B1
不创建 assistant placeholder
不启动 Trace
不调用模型
```

新 Thread Composer 从 Fork 字段重建 required origin Quote。用户最终发送时，服务端才创建 B1，并自动把 origin 放第一项。

## 4. Prompt Compiler

正式回答不再在 `generation-plan.ts` 临时拼 System、Messages 和工具，而是：

```text
compilePromptBase
  ├─ Stable Agent Kernel
  ├─ Frozen Inherited History
  ├─ Stable Branch History
  └─ detach Current User

resolve runtime
  ├─ actual model route
  ├─ research route / plan
  ├─ artifact intent
  └─ Tool Profile

finalizeGenerationPrompt
  ├─ Runtime Control
  ├─ Current User
  ├─ Prefix Hash / boundaries / eligibility
  ├─ input-window budget
  └─ Provider cache controls
```

### 4.1 稳定附件

冻结祖先历史和 Branch History 不得使用“当前问题驱动的 RAG”，否则同一历史会因本轮问题不同而产生不同文本。

因此：

- 稳定历史：确定性的全文截断或不可变解析结果；
- 当前用户附件：允许按本轮问题检索，属于动态尾部。

## 5. 工具前缀

工具 Schema 通常位于 System/Message 之前，是最早可能破坏缓存的位置。

第一阶段使用有限 Profile：

```text
thread-answer-v1
thread-artifact-v1
thread-web-v1
thread-web-artifact-v1
```

每个 Profile 固定：

- 工具名；
- 描述；
- JSON Schema；
- 顺序。

动态 Message ID、Query 和 route reason 只能进入服务端 execute closure，不能进入 Provider-visible Schema。Profile 变化是有意缓存分区，不能为了命中而扩大工具权限。

## 6. 模型线路与缓存能力

`resolveChatModelRoute()` 返回：

```text
LanguageModel
实际 Adapter
Gateway
Upstream model
Route ID
Routing policy version
Cache strategy / TTL / affinity / Usage capability
```

同一个产品模型经不同 Gateway 或 Relay 时，不视为相同缓存线路。

当前默认态度：

| Route | 默认策略 | 原因 |
|---|---|---|
| Vercel AI Gateway | 验证 `gateway-auto` | 类型支持不等于真实 Usage 已验证 |
| OpenRouter | `probe-required` | 需验证实际 Endpoint、affinity、marker 与费用 |
| UMAPIS Claude | `probe-required` | 第一条 Fake/未来 Live Probe 目标 |
| Private Relay | `probe-required` | OpenAI-compatible 不证明 Claude 缓存透传 |
| Ark / MiniMax / Cloudflare-compatible | `probe-required` | 不向未知代理猜测字段 |

未验证 Route 不发送专属缓存字段，也不宣称已省钱。

## 7. Route 级发布

环境变量：

```dotenv
THREAD_PROMPT_CACHE_MODE=off
THREAD_PROMPT_CACHE_ROUTE_MODES={"route-id":"observe"}
THREAD_PROMPT_CACHE_COHORT_PERCENT=0
THREAD_PROMPT_CACHE_AFFINITY_SALT=
THREAD_PROMPT_CACHE_EXTENDED_TTL_ENABLED=false
THREAD_PROMPT_CACHE_RETENTION_APPROVED=false
THREAD_PROMPT_COMPILED_SEGMENT_CACHE=off
```

模式：

- `off`：不启用缓存控制；
- `observe`：编译新 Prompt 和 Manifest，但不发送缓存参数；
- `enabled`：仅已验证 Route、且命中稳定 cohort 时发送缓存控制。

全局 `off` 是一键回滚。Route override 可以只开启一条线路。Cohort 使用服务端 HMAC 稳定分桶，不泄漏原始用户或 Project ID。

## 8. TTL 策略

第一阶段：

```text
优先 Provider 默认短时缓存
Route 明确支持时使用约 5 分钟
1 小时 Extended TTL 默认关闭
```

1 小时只有同时满足以下条件才可启用：

- Route 明确支持；
- `THREAD_PROMPT_CACHE_EXTENDED_TTL_ENABLED=true`；
- `THREAD_PROMPT_CACHE_RETENTION_APPROVED=true`；
- 真实会话间隔与 cache write/read 费用证明净成本更低；
- ZDR、区域与数据保留政策通过审查。

## 9. 缓存参数失败的处理

若 Provider 在**任何协议输出之前**拒绝 cache control、TTL、cache key 或 affinity：

```text
捕获明确的缓存控制拒绝
丢弃失败请求的 Usage rejection
用完全相同 Prompt、但无缓存参数重试一次
记录 fallback
```

一旦已经出现任何协议 Chunk，就不能自动重试，以免重复文本、工具调用或副作用。

缓存优化失败不能把本来能成功的回答变成失败 Message。

## 10. 如何判断一次请求发生了什么

系统区分：

```text
eligible          输入结构具备复用条件
cold-start        没有已知相同输入
partial-warm      最新 assistant 还未作为输入，可能只命中更早历史
provider-hit      Provider 明确报告 cache read > 0
provider-miss     Provider 明确报告 cache read = 0
usage-unavailable Provider 没有可靠字段
route-drift       实际 Endpoint/Route 改变
ttl-expired       已知相同前缀超过 TTL
below-minimum     前缀短于 Route 最小缓存长度
```

Prefix Hash 相同只能证明应用请求形状一致，不能替代 Provider 命中证据。

## 11. 成本和质量门禁

真实总成本包括：

```text
未缓存输入
缓存写入
缓存读取
输出
Gateway / Relay 固定或比例费用
路由漂移造成的缓存失效
```

Route 只有在以下条件同时成立时才能启用：

- 回答质量不下降；
- Quote 理解不下降；
- 工具行为不下降；
- 安全检查通过；
- 终态可靠性不下降；
- 真实总成本可证明下降。

缺少成本字段时结论是 `cost-not-proven`，不是“免费”或“已省钱”。

## 12. Fake Claude Probe

仓库提供：

```bash
pnpm prompt-cache:probe
```

它使用固定的 Fake Claude Usage、价格和质量信号验证：

- cache read 能降低净输入成本；
- cache write/read/output 全部计费；
- 质量下降时即使更便宜也拒绝启用；
- Usage 不完整时拒绝宣称成本下降。

`--live` 默认拒绝执行，直到有明确批准的 Provider Adapter、凭据和数据保留配置。Fake Probe 验证的是决策逻辑，不代表 UMAPIS/Claude 线上已经命中。

## 13. 可观测性与评测

生产默认只记录：

```text
Compiler / Kernel / Quote / Cache / Tool Profile 版本
Route ID
Stable Prefix Hash / Fork Context Hash
Quote 数量
cache read / write / uncached input / output
TTFT / duration / finish reason / cost
eligibility / outcome / reason code
```

禁止记录 Prompt、Quote 正文、Source ID、TextAnchor、附件正文、网页正文和凭据。

Agent Eval Candidate Fingerprint 包含所有缓存相关版本和 Route policy，避免不同配置被误当成同一候选。Prompt Cache 使用独立 Fixture Suite，不改变既有数据集 Revision 和基线。

## 14. L2 Compiled Segment Cache

L1 Provider KV Cache 是首要收益来源。

L2 只用于减少数据库读取、Attachment 展开、Message 转换与 Hash 计算，不减少模型 Token。仓库提供：

- `NoopCompiledSegmentCache`：默认；
- 有界进程内 LRU：仅用于测量；
- 用户 + Project HMAC 隔离 Key；
- TTL 与容量限制。

在跨实例收益和隐私控制没有证据前，不引入 Redis，不复制 Prompt 到外部分布式缓存。

## 15. 常用验证命令

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test:thread-chat:prompt-cache
pnpm test:thread-chat:prompt-cache-eval
pnpm test:thread-chat:composer-quotes
node --import tsx e2e/thread-chat/quote-resolver-contract.test.mjs
node --import tsx e2e/thread-chat/prompt-cache-rollout.test.mjs
node --import tsx e2e/thread-chat/prompt-cache-state.test.mjs
pnpm prompt-cache:probe
pnpm test:observability
pnpm test:agent-evals
pnpm openspec:validate
```

GitHub Actions 的 `Prompt Cache Final Verification` 还会启动临时 pgvector PostgreSQL，执行全部 Thread Chat 数据库与协议 Gate。
