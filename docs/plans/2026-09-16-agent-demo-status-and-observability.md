# Agent Demo 状态与观测性笔记（探索期）

> 状态记录，非设计定稿。本项目是 fast demo，以探索为主，下文方案均待后续决策。

日期：2026-09-16
相关代码：`app/agent-demo/`、`app/api/agent-*/`、`lib/agent-demo/`

## 当前状态

- 执行链路：页面建任务 → e2b 沙箱 clone 仓库 → 注入本机 `credentials.toml` → `devin acp --model swe-2-high`（ACP over stdio）→ ACP `session/update` 映射为规范化事件 → SSE 推页面 → git 提交推送 → GitHub Draft PR → 杀沙箱。
- **沙箱模板**：`E2B_TEMPLATE=devin-acp-agent` 已启用——devin CLI 烤进镜像（`pnpm agent-demo:build-template` 重建），跳过任务内安装；内存提到 2GB（base 512MB 会 OOM pnpm install）。不设该变量则走 base 镜像 + 任务内现装。
- 事件权威源：**沙箱内 tee 落盘的 jsonl 文件轮询**（e2b `onStdout` 推送实测会中途静默断开，不可靠）。
- **模型**：`--model swe-2-high` 固定。SWE-2 全家在当前 Teams 账号标注 Free；不指定会走组织默认，可能命中计费模型。任务实测用量 ~30k input / ~6k output。
- **超时三层**：runner 55min 预算（中止 agent → 照常 verify/publish，交付 partial PR）→ e2b 58min 硬超时 → ACP 进程退出时 pending 请求全 reject（防任务假死 running）。
- 存储：内存表，dev server 重启即丢。
- 已验证交付：`hifizz/playground.zilin.im` PR #18（reasoning/effort 面板）、`hifizz/ai-daily` PR #8/#9/#10。模板路径端到端 155s（简单任务）。
- 加固记录：`4434844` 轮询告警 + stdin 重试；`d401b49` 固定模型；`ffec85e` 预建模板；`2dbd6dd` 超时预算 + partial 收尾。

## 耗时分析：task-f0d4bbea（总 821s）

事件表 `occurredAt` 为**观测方收到事件的时间**，非沙箱内真实时间；断流积压的事件恢复后时间戳被压缩，存在 ±2min 观测误差。

| 阶段 | 耗时 | 说明 |
|---|---|---|
| environment | 17s | 沙箱 5.5s + clone 1.2s + devin 安装 5.6s + ACP 握手 4.5s |
| agent | 796s | 占 97%，拆解见下 |
| verify+publish+release | 8s | 无瓶颈 |

agent 阶段拆解：

- 工具实际执行仅 ~75s（41 次调用，最慢 `npx` 16.7s）
- ~144s 为 e2b 断流观测空白（agent 未停，是我们看不见）
- ~100s pnpm install 弯路：478MB 内存 OOM → devin 自行改用 esbuild 校验
- 其余 ~470s 为模型推理/生成时间（103s→392s 间无工具调用，纯生成大文件）

**结论：瓶颈是模型推理时长，不是管道。**

## 观测方案（分层，未实施）

### 第 0 层（已有）

- 事件表 occurredAt + phase 边界 + tool.started/finished 配对即可出耗时报告（本次分析即用此法）。

### 第 1 层（小改动，建议优先）

1. devin stderr 不再丢 `/dev/null`，tee 到 `/tmp/devin-err.log`；
2. release 前归档 acp jsonl + devin log 到本地 run artifact（事后可回放真实时间线）；
3. 映射 `usage_update`（token 用量已在推，当前被丢弃）；
4. 心跳事件：agent 阶段 >30s 无事件则发 heartbeat，页面显示"模型思考中…已静默 Xs"——区分"断流"与"模型想得久"；
5. result 增加 `timing` 字段（各阶段耗时、工具总耗时）。

### 第 2 层（系统化，生产化时）

- OTel + GenAI 语义规范，LLM call / tool call 各一 span，进 Langfuse；
- 结构化日志接现有 `lib/axiom`。

## 业界做法（Devin / Claude Code / agentic infra 共性）

1. **事件溯源 + 持久化**：append-only event log（Postgres/Kafka）为唯一事实源；
2. **durable execution**：工作流状态持久化 + worker lease/heartbeat + 崩溃 replay（Temporal/Restate）；
3. **沙箱预热**：自定义 e2b template 把 devin 烤进镜像（17s→~5s），更大规模用 warm pool；
4. **短期凭据**：GitHub App installation token 按任务签发，替代长期 PAT 拷进沙箱；
5. **观测三件套**：LLM 级 tracing、phase 耗时 p50/p95、stuck-task 检测器；
6. **资源预算**：max runtime / max turns / 内存配额，防 agent 跑飞。

## 生产化优先级（待决策）

① 第 1 层观测 → ② 事件表落 Postgres（重启不丢）→ ~~③ e2b 自定义模板~~（已做 `ffec85e`）→ ~~④ 超时预算~~（已做 `2dbd6dd`，55min 预算 + partial 收尾）→ ⑤ worker lease。

## 大任务处理（后续再议）

- 断点续跑：超时后用同一任务分支再起任务接力（分支已推送，第二个 agent 可续改）；
- 模型降档提速（swe-2-medium）或提示词要求"先最小可交付再迭代"；
- `sandbox.setTimeout()` 运行中续期（Hobby 单次上限仍是 1h）。

## 已知坑位（备忘）

- e2b `onStdout` 推送会静默断开且无错误信号 → 文件轮询为权威源；
- `files.read` 瞬断会自恢复，旧代码静默吞错导致"假死"观感（已加告警事件）；
- `commands.run` 非零退出抛 `CommandExitError`，需 `runChecked` 包装；
- devin `install.sh` 末尾交互式 setup 必失败，用 `devin version` 验证安装；
- ACP `clientCapabilities` 不可声明 fs/terminal，否则写文件反向委托 client 卡死；
- devin 会发 `session/request_permission`，需自动批准且拒绝 git 变更类命令（发布是 runner 职责）。
