# Agent Demo 状态与观测性笔记（探索期）

> 状态记录，非设计定稿。本项目是 fast demo，以探索为主，下文方案均待后续决策。

日期：2026-09-16
相关代码：`app/agent-demo/`、`app/api/agent-*/`、`lib/agent-demo/`

## 当前状态

- 执行链路：页面建任务 → e2b 沙箱 clone 仓库 → 安装 devin CLI → 注入本机 `credentials.toml` → `devin acp`（ACP over stdio）→ ACP `session/update` 映射为规范化事件 → SSE 推页面 → git 提交推送 → GitHub Draft PR → 杀沙箱。
- 事件权威源：**沙箱内 tee 落盘的 jsonl 文件轮询**（e2b `onStdout` 推送实测会中途静默断开，不可靠）。
- 存储：内存表，dev server 重启即丢。
- 已验证交付：`hifizz/playground.zilin.im` PR #18（reasoning/effort 面板 demo）、`hifizz/ai-daily` PR #8/#9。
- 最新加固（commit `4434844`）：轮询连续失败 3 次发伪工具卡告警、恢复后补读；stdin 写入重试 4 次（防 `request_permission` 应答丢失导致 devin 永久等待）；`request()` 送达失败即 reject。

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

① 第 1 层观测 → ② 事件表落 Postgres（重启不丢）→ ③ e2b 自定义模板 → ④ worker lease + 超时预算。

## 已知坑位（备忘）

- e2b `onStdout` 推送会静默断开且无错误信号 → 文件轮询为权威源；
- `files.read` 瞬断会自恢复，旧代码静默吞错导致"假死"观感（已加告警事件）；
- `commands.run` 非零退出抛 `CommandExitError`，需 `runChecked` 包装；
- devin `install.sh` 末尾交互式 setup 必失败，用 `devin version` 验证安装；
- ACP `clientCapabilities` 不可声明 fs/terminal，否则写文件反向委托 client 卡死；
- devin 会发 `session/request_permission`，需自动批准且拒绝 git 变更类命令（发布是 runner 职责）。
