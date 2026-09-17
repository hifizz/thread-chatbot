## 1. 运行基线

- [ ] 1.1 阅读当前 Fly/安装版 Next.js 运行文档，清点部署、后台 Generation、本地文件和共享缓存依赖。
- [ ] 1.2 测量用户/App/Neon/provider 延迟与内存负载，确定区域、规格、pool 和扩容上限。
- [ ] 1.3 设计环境配置/密钥白名单、release SHA 和 staging 隔离。

## 2. 部署与共享状态

- [ ] 2.1 实现同一构建镜像、fly.toml、liveness/readiness，不在构建或多实例启动时生成 migration。
- [ ] 2.2 审计并修复余额/预算/邀请/Generation/取消/cursor/outbox 的实例内事实依赖。
- [ ] 2.3 复用共享对象存储和 owner guard，检查多实例 Next.js session/加密/cache 一致性。
- [ ] 2.4 当前进程后台任务阶段关闭不安全 autostop，验证无连接仍有任务时不会停机。

## 3. 生命周期与恢复

- [ ] 3.1 实现部署前 drain、新准入关闭、平台终止边界和 flush 上限。
- [ ] 3.2 演练进程崩溃、lease/CAS、结果恢复和未知费用对账，不盲目重跑外部调用。
- [ ] 3.3 develop 单点生成/审查/升级验证 migration；发布只应用已审核产物。
- [ ] 3.4 批准 RPO/RTO，隔离环境恢复 DB/附件并验证删除/账务/权限，再演练旧镜像回滚。

## 4. 发布验收

- [ ] 4.1 双实例验证登录、聊天、分支、Artifact、上传、停止/刷新和跨账号权限。
- [ ] 4.2 并发压测余额/限流/连接池/长任务，记录成本与容量证据。
- [ ] 4.3 与 #168 配置外部可用性/OOM/积压/预算告警并验证送达。
- [ ] 4.4 运行相关测试/typecheck/build 及 pnpm exec openspec validate flyio-production-deployment --strict，记录切换与回滚 runbook。

本 PR 只写方案，不创建基础设施或执行部署。
