## Why

ThreadChat 需要为 Beta 提供可重复发布、受控扩容和可恢复运行环境。迁往 Fly.io 不能只提交 Dockerfile：后台 Generation、Neon 延迟、持久附件、共享预算及部署中任务收尾都会决定真实体验。

## What Changes

- 设计单主区起步、靠近 Neon 写库的部署策略，先完成双实例兼容与压测，不默认多区写入。
- 定义镜像/配置/密钥、健康与就绪、部署前 drain、对象存储、数据库连接和迁移流程。
- 明确应用全局状态不能依赖进程内存；浏览器断连不等于任务结束。
- 设计外部监控、恢复/回滚演练和按实测并发/内存/成本决定的扩容边界。

## Capabilities

### New Capabilities

- `flyio-beta-runtime`: Fly.io 生产运行、状态共享、发布、恢复与容量验证。

### Modified Capabilities

无。保留现有 Generation 执行器及部署契约，运行环境迁移不引入第二套 Agent runtime。

## Impact

后续可能修改 Dockerfile、fly.toml、环境校验、健康路由、进程生命周期与 CI/CD。此 PR 仅 OpenSpec，不创建 Fly 应用、不部署、不读取或写入生产 secrets。

## Dependencies

Git 基于 main@5731a9d，可并行设计；运行时集成必须验证 #164 共享预算、#166 准入、#167 搜索快照/预算、#168 观测。数据迁移遵守 CLAUDE.md：develop 单一集成生成并验证，main 只接收产物。

## Non-goals

不引入 Kubernetes、自动无限扩容、多主数据库或为换平台重写全部执行器；不承诺最低内存机器足够或搬迁本身必然提速。
