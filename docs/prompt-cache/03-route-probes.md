# Prompt Cache Route Probe 记录

## 决策原则

缓存不是“开了就省钱”。每条真实 Route 必须分别验证：

```text
输入未缓存成本
缓存写入成本
缓存读取成本
输出成本
Gateway / Relay 附加费用
路由漂移造成的冷缓存
```

只有同时满足以下条件才允许启用：

1. 回答质量不下降；
2. 引用理解不下降；
3. 工具选择和执行不下降；
4. 安全、隔离和 Message 终态不回归；
5. Provider 能提供可信缓存证据；
6. 真实总成本下降。

## 当前 Route 状态

| Route 类别 | 当前状态 | Production 缓存 | TTL | 说明 |
|---|---|---:|---|---|
| UMAPIS Claude | `probe-required` | 关闭 | 计划验证约 5 分钟 | 普通 Claude 调用可用，不等于 cache-control 和 Usage 会透传 |
| Private Relay | `probe-required` | 关闭 | Provider default | OpenAI-compatible 只证明普通调用兼容 |
| OpenRouter implicit | Adapter 支持，待小流量验证 | 默认关闭 | Provider default | 可使用 Project/模型级 HMAC affinity |
| Vercel AI Gateway auto | Adapter 支持，待真实成本验证 | 默认关闭 | Provider default | 需要读取实际 Provider metadata |
| Cloudflare compatible | `probe-required` | 关闭 | Provider default | 不向 compatible endpoint 猜测性发送专属字段 |
| Ark | `probe-required` | 关闭 | Provider default | 还需验证 Prompt Cache 与套餐计费边界 |
| MiniMax | `probe-required` | 关闭 | Provider default | 尚无稳定 cache Usage 证据 |
| OpenAI direct | 隐式缓存能力，待 Route 验证 | 默认关闭 | Provider default | 仍需真实 Usage 和成本对账 |

## Fake UMAPIS Claude Probe

用户允许在缺少真实凭据时使用可重复 fake probe。该实验验证的是：

- warm-up 第一次写入；
- 同一 `routeId + stablePrefixHash` 第二次读取；
- 五分钟 TTL 过期后重新冷启动；
- cache read/write Token 归一化；
- 缓存写入、读取、未缓存输入、输出和网关费用的成本公式；
- 质量门禁失败时，即使更便宜也不得启用。

运行：

```bash
node --import tsx scripts/probe-prompt-cache.ts
```

输出明确标记：

```text
mode = deterministic-fake
productionRouteState = probe-required
extendedTtlEnabled = false
```

Fake 结果不能证明 UMAPIS 生产线路已经支持缓存，因此不会自动修改 Production Route 状态。

## 真实 UMAPIS Claude 验收条件

将来具备受控凭据时，至少运行：

```text
1. 固定长前缀 warm-up
2. TTL 内同 Route 复用
3. 不同 B1 Quote 的兄弟分支复用
4. 五分钟附近的有效/失效边界
5. Provider fallback / route drift
6. 普通回答、Web、Artifact 和失败场景
```

必须保存：

- Probe 日期；
- 应用 Commit；
- AI SDK/Adapter 版本；
- app model、upstream model 和 route ID；
- Cache 请求参数；
- cache read/write Usage 原始来源；
- TTFT；
- Provider/Gateway 实际费用；
- 质量和工具评分；
- retention / ZDR 结论。

拿不到 cache Usage，或成本不能明确下降时，继续保持 `probe-required`。

## Anthropic 官方参考 Probe

如果未来配置 Anthropic 直连凭据，可以用相同输入做参考实验，判断：

- 代理是否丢失 cache-control；
- 代理是否隐藏 cache Usage；
- 代理是否增加足以抵消缓存收益的费用；
- 路由是否比直连更容易漂移。

参考实验不要求 Production 立即切换供应商。

## TTL 策略

第一阶段：

```text
Provider default / 约 5 分钟短缓存
```

明确关闭：

```text
1 小时 Extended TTL
```

只有以下条件同时满足，才允许另行按 Route 开启 1 小时：

- 真实会话间隔显示五分钟不够；
- 额外写入成本能被后续读取摊薄；
- 数据保留、ZDR、region 和 Provider policy 允许；
- 回归评测继续通过。

当前代码将 `extendedTtlEnabled` 固定为 `false`，环境变量不能绕过。

## 回滚

任何 Route 可以通过以下方式立即关闭：

```dotenv
THREAD_CHAT_PROMPT_CACHE_MODE=off
```

或者只关闭指定 Route：

```dotenv
THREAD_CHAT_PROMPT_CACHE_ROUTE_MODES={"route-id":"off"}
```

回滚不需要数据库迁移，也不会修改已有 Thread、Message 或 Quote Snapshot。
