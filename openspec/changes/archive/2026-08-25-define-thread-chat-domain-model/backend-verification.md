# 后端领域验收证据

## 自动化门槛

| 门槛 | 命令 | 结果 |
|---|---|---|
| 领域单元测试 | `pnpm test:unit` | 4 个文件、14 个测试通过 |
| Repository / Application / Runtime 集成测试 | `pnpm test:integration` | 5 个文件、20 个测试通过；使用隔离的 `thread-chat-test` PostgreSQL |
| TypeScript | `pnpm typecheck` | 通过 |
| OpenSpec | `pnpm openspec:validate` | 27 项严格校验通过 |

## 覆盖映射

| 领域能力 | 自动化证据 |
|---|---|
| Root / Branch、无环拓扑、BaseContext、replacement、Fork 资格、MessageRun 状态机、Prompt History | `tests/unit/domain-model.test.ts` |
| owner scope、唯一 Root、并发 sequence、finalized 不可变、Artifact provenance、单一 MessageRun | `tests/integration/normalized-schema.test.ts`、`tests/integration/repositories.test.ts` |
| create、send、Fork、Edit、Regenerate、metadata、feedback、delete 及失败回滚 | `tests/integration/application.test.ts` |
| 条件领取、delta checkpoint、eventSequence、heartbeat、completed、failed、Stop、queued scanner、Artifact tool output | `tests/integration/message-runner.test.ts` |

自动化测试只使用 `FakeAiRuntime`，不会请求真实模型供应商。
