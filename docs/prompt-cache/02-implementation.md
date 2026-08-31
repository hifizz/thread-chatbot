# Thread Chat 引用与 Prompt Cache 实施说明

## 目标

本次实现把“分叉引用”和“缓存”统一成一条后端链路：

```text
稳定工具定义
稳定 Agent Kernel
冻结祖先历史
已完成的当前分支历史
---------------- 可复用前缀结束 ----------------
本轮运行控制
当前用户：Quote × 0..50 + 总问题 + 附件
```

具体划选文字不再放入最前面的 System Prompt。兄弟分支在真正出现各自 B1 之前，可以发送完全相同的祖先前缀。

## 当前实现基线

实施前的主要问题：

```text
Tools（本轮动态）
System = 通用规则 + 具体 anchorText + Research Plan
Messages = 冻结祖先历史 + B1
```

由于 `anchorText` 和 Research Plan 出现在祖先历史之前，不同分支很早就产生输入差异。

实施后的主要结构：

```text
Tool Profile（版本化、固定顺序）
System = 稳定 Agent Kernel
Messages:
  Frozen Inherited History
  Completed Branch History
  Runtime Control
  Current User Message
```

`Current User Message` 内部使用：

```text
data-quote × 0..50
text × 0..1
file × 0..20
```

## 已实现模块

### 1. Quote 协议

`thread-quote-v1` 保存：

- 服务端生成的 Quote ID；
- `branch-origin` 或普通 `selection`；
- 冻结正文；
- 可选逐条 comment；
- 来源 Project、Thread、Message 或 Artifact；
- DOM 无关的 `TextAnchor`。

历史 `{ text }` Quote 继续可读，新写入只产生 V1。

### 2. 当前 Thread-only 来源策略

普通 Quote 只允许来自目标 Composer 所属当前 Thread：

- `completed` assistant Message；
- 当前 Thread 的 completed assistant Message 产生的 Markdown Artifact。

`generating`、`stopped`、`failed`、已 supersede、其他 Thread 和其他 Project 一律拒绝。

唯一跨 Thread 例外是 Fork 自己的 `branch-origin`，它由服务端从 Thread Fork 字段生成，客户端不能伪造。

### 3. 两条 B1 路径

直接带问题开分支：

```text
创建 Thread B
生成 branch-origin Quote
创建 B1 + BA1
启动生成
```

先建空分支：

```text
只创建 Thread B
Composer 从 Fork 字段重建 required Quote
用户以后第一次发送时，服务端生成同一 branch-origin Quote
```

两条路径的模型可见 B1 内容相同。

### 4. Prompt Compiler

Prompt Compiler 分成：

- Agent Kernel；
- Frozen Inherited History；
- Branch History；
- Runtime Control；
- Current User。

它生成：

- `forkContextHash`；
- `toolProfileHash`；
- `stableRequestPrefixHash`；
- `fullRequestShapeHash`；
- `kernel-end / inherited-end / branch-history-end` 候选边界；
- Route、TTL、资格和版本信息。

Hash 只描述模型实际看到的请求结构。Quote 来源 ID、TextAnchor、标题、脚注、列位置、Draft/Command/Trace ID 不参与模型输入和前缀 Hash。

### 5. Tool Profile

当前 Profile：

```text
thread-answer-v1
thread-artifact-v1
thread-web-v1
thread-web-artifact-v1
```

Profile 内工具名称和顺序固定。Message ID 仅存在于服务端 execute closure，不进入 Provider 可见 Schema。

### 6. Route 与缓存能力

`ResolvedChatModel` 现在同时返回：

- 实际 Adapter；
- Gateway；
- upstream model；
- `routeId`；
- 路由策略版本；
- 输入窗口预算；
- 缓存策略、Usage、TTL 和 affinity 能力。

UMAPIS Claude、Private Relay、Ark、MiniMax 和普通 compatible endpoint 在没有真实证据前保持 `probe-required`。

### 7. Route 级发布

环境配置：

```dotenv
# off | observe | enabled
THREAD_CHAT_PROMPT_CACHE_MODE=off

# JSON；可单独覆盖某条 route
THREAD_CHAT_PROMPT_CACHE_ROUTE_MODES={"openrouter:example-model":"observe"}

# OpenRouter 等路由亲和使用；必须是服务端 secret
PROMPT_CACHE_AFFINITY_SALT=replace-with-high-entropy-secret
```

语义：

- `off`：不发送缓存控制；
- `observe`：使用新 Prompt 与 Manifest，但不发送 Provider 缓存控制；
- `enabled`：只有 capability 已声明支持的 Route 才发送缓存控制。

UMAPIS Claude 当前仍为 `probe-required`，即使全局设置 `enabled` 也不会猜测性发送缓存字段。

### 8. 安全降级

如果已验证 Route 在模型尚未产生任何输出前拒绝缓存字段：

```text
第一次：带缓存控制
兼容错误
第二次：普通请求
```

只允许在零输出、零工具副作用时重试。一旦已经产生正文或工具事件，不会重复请求。

### 9. 输入预算

50 是 Quote 块数量上限，不是无限输入。

发送前检查：

- 单份正文；
- comment；
- Quote 总字符和粗略 Token；
- 实际 Route 的完整输入窗口；
- 预留输出空间。

超出时在付费模型请求之前返回 `INPUT_BUDGET_EXCEEDED` 语义错误，不静默截断、删除或摘要。

## 数据库影响

本次没有数据库迁移。

- `threads` 的 Fork 字段仍是拓扑事实；
- `messages.parts` JSONB 是 Quote Snapshot 的唯一事实源；
- `MessageDTO.parts` 仍是唯一传输入口；
- 没有新增 Quote 表或顶层 `quotes` 字段。

## 本地实施验证

在当前分支快照上已执行：

```text
pnpm typecheck
pnpm lint
pnpm build
Prompt Cache contract tests
Prompt Cache eval tests
Deterministic fake cache probe
Thread Chat non-DB gates
Observability tests
Agent eval tests
OpenSpec strict validation
```

数据库和全部门禁由 `.github/workflows/prompt-cache.yml` 使用独立 PostgreSQL/pgvector 服务再次验证。最终以 PR 的 GitHub Actions 结果为准。
