# Prompt Cache Apply 验证记录

## 基准

- 验证日期：2026-09-01
- Base branch：`codex/feat-agent-observability-evaluation`
- Base SHA：`2f3024747ddb72e1e69aa916cb45addb7140f6ab`
- Apply branch：`codex/design-thread-chat-prompt-cache`
- OpenSpec change：`optimize-thread-chat-prompt-cache`

## Base 实施前基线

在 Base 的独立仓库快照上执行：

```text
pnpm install --frozen-lockfile       PASS
pnpm typecheck                       PASS
pnpm build                           PASS
Thread Chat gate2 session            PASS
Thread Chat gate2 pipeline           PASS
Thread Chat gate3 client             PASS
Thread Chat gate4 cutover            PASS
pnpm test:observability              PASS
pnpm test:agent-evals                PASS
openspec validate --all --strict     PASS
```

数据库门禁不使用生产数据库，最终由 PR 的 Prompt Cache GitHub Actions 在独立 `pgvector/pgvector:pg17` 服务中执行。

## 锁定实现版本

本次实现基于仓库锁定依赖：

| 组件 | 版本 |
|---|---|
| Node.js | `>=22`；CI 使用 Node.js 24 |
| pnpm | `10.32.1` |
| AI SDK | `7.0.83` |
| `@ai-sdk/anthropic` | `4.0.44` |
| `@openrouter/ai-sdk-provider` | `3.0.0` |
| Next.js | `16.3.1` |
| Drizzle ORM | `0.45.2` |
| PostgreSQL CI | 17 + pgvector |

## 实现分支本地验证

在 Apply 分支最新代码快照上执行：

```text
pnpm typecheck                                      PASS
pnpm lint                                           PASS
pnpm build                                          PASS
Prompt Cache parser / Quote / Prefix contracts      PASS
Prompt Cache extended budget / cost contracts       PASS
Quote Composer / Markdown batch contracts           PASS
Cache fallback stream contracts                     PASS
Prompt rollout off / observe / enabled contracts    PASS
Cache warmth contracts                              PASS
Prompt Cache metadata privacy contracts             PASS
Prompt Cache eval quality/cost gate                  PASS
Deterministic fake cache probe                       PASS
Thread Chat non-database gates                       PASS
pnpm test:observability                              PASS
pnpm test:agent-evals                                PASS
openspec validate --all --strict                     PASS
```

## GitHub Actions 门禁

`.github/workflows/prompt-cache.yml` 使用隔离 PostgreSQL 服务执行：

- migrations；
- typecheck、lint、build；
- Quote current-thread-only 数据库测试；
- direct Fork 与 empty Fork 后首问的数据库等价测试；
- 全部 Prompt Cache / Composer / fallback / rollout / privacy 合同；
- Thread Chat 数据库与非数据库 Gates；
- Observability；
- Agent Eval；
- OpenSpec strict validation。

只有该 Workflow 在当前 Head 上为绿色，才允许把最终 `tasks.md` 全部勾选。

## Claude / Provider Probe 状态

### 已完成

- Deterministic fake UMAPIS-Claude-style warm-up/reuse；
- 约 5 分钟短 TTL；
- cache write/read/uncached input/output/Gateway fee 成本公式；
- Route drift 造成的额外成本；
- 质量门禁；
- 缓存控制兼容错误的零输出安全降级。

### 未宣称完成的外部事实

当前没有把 Fake 结果表述成真实 UMAPIS 生产命中。生产状态仍是：

```text
UMAPIS Claude: probe-required
1 小时 Extended TTL: disabled
Production enabled route: none by default
```

真实 Route 只有在能够证明 cache-control 透传、Provider Usage、真实总成本下降且质量无回归后，才可以通过 Route 级配置和小 cohort 开启。

## 无数据库迁移结论

本 change 没有新增数据库表或 migration：

- `threads` Fork 字段继续表达拓扑；
- `messages.parts` JSONB 保存 Quote Snapshot；
- `MessageDTO.parts` 仍是唯一传输事实；
- 不新增顶层 `quotes` 或独立 Quote 事实源。
