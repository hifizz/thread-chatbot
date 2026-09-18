# Fly.io 部署与恢复 Runbook

ThreadChat 生产运行时部署在 Fly.io Machines 上。本文档是切换、drain、恢复与回滚的操作手册；运行时契约由代码与 `fly.toml` 承载，本文件只描述「人怎么操作」。

> 范围声明：本文件描述的是目标流程。真实生产部署、双实例流量、备份恢复与回滚演练尚未执行，完成前不得对外宣称已验收。

## 一、架构契约

- **同一 release**：staging 与 production 部署同一 git SHA 构建的同一镜像（仓库根 `Dockerfile` → Next standalone）。`deploymentId` 自动取 `FLY_IMAGE_REF`，同镜像的所有 Machine 共享。
- **单写区**：`primary_region` 必须与 `DATABASE_URL` 主写区域同区；staging/production 各有独立的 app、数据库、R2 桶与 secrets。
- **共享事实**：余额/预算/邀请/Generation/取消/cursor/附件全部以 PostgreSQL 与 R2 为准，进程内存只放 Session 投影。
- **多实例属主**：`messages.generation_owner` + `generation_heartbeat_at` 是生成 lease；`stop_requested_at`/`superseded_at` 是跨实例控制通道；属主实例周期轮询并本地 abort。
- **跨实例请求**：本机无 Session 时，Fly 上以 `fly-replay: instance=<owner>;fallback=prefer_self` 定向；属主心跳过期则把孤儿终态化为 `SESSION_LOST`。
- **长任务与停机**：`auto_stop_machines="off"`（后台 Generation 不依赖 HTTP 连接）；`min_machines_running=2`。
- **健康检查**：`/readyz` 是 service check（drain 中 503 摘除流量），`/healthz` 是 machine check（进程死亡才重启）。
- **终止边界**：SIGTERM → drain 钩子关准入、有界收尾（20s）→ 遥测 flush（5s）→ 退出；`kill_timeout=30s` 只兜底，长任务排空必须走部署前 drain。

## 二、密钥与环境

`fly secrets set` 管理，绝不写入镜像或仓库：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` / `DIRECT_URL` | 池化运行时连接 / 迁移直连（分区一致） |
| `BETTER_AUTH_SECRET` | ≥32 字符高熵 |
| `TOKEN_ROUTER_BASE_URL` / `TOKEN_ROUTER_API_KEY` | 模型路由 |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | `openssl rand -base64 32`，**所有实例必须同一把** |
| `CRON_SECRET` | `/api/internal/drain`、`/api/billing/reconcile` 机器凭证 |
| `R2_*` | 附件对象存储（四个值要么全配要么全不配） |
| `RESEND_API_KEY`、`AXIOM_*`、`LANGFUSE_*` | 可降级能力，缺失只告警不阻断 |

启动时 `instrumentation.ts` 执行环境白名单校验：Fly 生产缺关键配置直接启动失败（避免半配置带病运行）；非 Fly 宿主降级为告警。

## 三、发布流程

```bash
# 0. migration 只在需要时执行（develop 已生成并验证的产物），且必须在 drain 之前：
DIRECT_URL=... node scripts/fly-migrate.mjs --confirm production

# 1. 排空：对每台 Machine 定向关闭新准入并等待在途任务归零
FLY_API_TOKEN=... CRON_SECRET=... node scripts/fly-drain.mjs --app thread-chat --wait 120000

# 2. 部署同一 SHA 的镜像
fly deploy --app thread-chat
```

- `fly-drain.mjs` 对每台 Machine 以 `fly-force-instance-id` 调 `POST /api/internal/drain`（默认 graceful：在途任务跑完；`--abort` 仅紧急替换使用）。
- drain 后 `/readyz` 返回 503，service check 自动把实例摘除，新 Generation 返回 `CAPACITY_UNAVAILABLE`。
- 排空超时仍可部署：剩余任务由 SIGTERM 有界收尾兜底，超时未终态的行由心跳清扫收敛为 `PROCESS_RESTARTED`。

## 四、回滚

```bash
fly releases --app thread-chat          # 找到上一个镜像版本
fly deploy --app thread-chat --image registry.fly.io/thread-chat:<prev-image-tag>
```

- 回滚同样先执行 drain（步骤 1）。
- schema 只向前兼容：新代码写入的旧版本可读字段；回滚镜像与当前 schema 的兼容性必须在发布前评估（见任务 3.4）。

## 五、恢复

- **进程崩溃**：Machine 由 liveness check 重启；启动清扫只处理「无心跳且停留超过陈旧窗口」的行，不会误杀其他活实例的生成。
- **属主实例死亡**：心跳 45s 过期 → 周期清扫（60s 间隔）或下次 stop/stream 请求触发 `SESSION_LOST`/`PROCESS_RESTARTED` 终态；不会盲目重放不确定的付费工作。
- **断连≠结束**：SSE 断开只移除订阅者，后台生成继续，checkpoint 周期落库，刷新经数据库恢复终态（不重放 token 流）。
- **部署中断**：`deploy-drain` 取消映射为 `DEPLOY_INTERRUPTED` 失败终态，前端可提示重试；账务结算与终态 CAS 幂等，不重复扣费。
- **RPO/RTO**：以 PostgreSQL 托管方备份为准（附件在 R2）；恢复演练与基线批准属于任务 3.4，尚未真实执行。

## 六、验证入口

- `GET /healthz`：进程存活 + release + instance（公开，无密钥）。
- `GET /readyz`：drain 状态 + DB 探测（短缓存 + 超时，不调用模型/搜索）。
- `GET/POST /api/internal/drain`：机器身份（CRON_SECRET），POST 支持 `{waitMs, abort}`。
- CI：`fly-runtime` workflow（drain/env 单测、lease DB 验收、fly.toml 静态检查、Docker build）。
