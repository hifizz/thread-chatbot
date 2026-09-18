# 项目文档工具：修复前后对比

这组实验回答：同一个模型在相同上下文里，修复后的工具协议是否减少来源混用、重复失败，并让用户得到正确的资料事实。

执行位置是本机或 CI。真实模型决定调用什么工具，模拟后端返回固定的合成资料，评分器检查完整调用记录和最终答案；Langfuse 接收每次实验的输入、输出、分数和版本信息。模型不会读写生产数据库，也不会访问真实网页。

## 先查看计划

```bash
pnpm eval:agent:documents
```

默认 6 个场景 × 3 个模型 × 3 次重复 × 旧/新 2 个版本，共 **108 次对话**；每次对话最多 12 个模型步骤，并非仅 108 次模型请求。默认命令只打印题目、预期答案、版本指纹和数量，不调用模型、不上传数据。

## 开始真实评测

命令自动加载当前工作区的 `.env.local`，已有进程环境变量优先。需要 `TOKEN_ROUTER_BASE_URL` 和 `TOKEN_ROUTER_API_KEY`。先跑一个模型、一次重复确认配置：

```bash
pnpm eval:agent:documents --live --models=private-relay-gpt-5.6-luna --repeats=1
```

再跑完整旧/新对比：

```bash
pnpm eval:agent:documents --live --repeats=3
```

模型默认来自项目注册表中已有的 Luna、Astra、Opus 5 public ID；用 `--models=id1,id2` 指定。重复次数为 1–20。不要设置 `THREAD_CHAT_DOCUMENT_WRITES=false`：评测必须暴露写工具才能测到不当写入意图，模拟执行器会拒绝所有写入，不会真的改文档。

## 在 Langfuse 查看

```bash
AI_OBSERVABILITY_ENVIRONMENT=evaluation \
  pnpm eval:agent:documents --live --langfuse --repeats=3
```

还需要 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 和对应实例的 `LANGFUSE_BASE_URL`，并且没有关闭 `AI_TELEMETRY_ENABLED`/`AI_LANGFUSE_ENABLED`。远端注册失败会在模型请求前退出。CLI 创建独立的 evaluation 遥测环境，结束时 flush 并关闭 exporter。

复用现有 `runLangfuseAgentExperiment` 导出**本地题集实验**，不创建或改写共享的 hosted Dataset。实验名为 `project-document-tool-routing`，run 名带模型、baseline/current、重复轮次和唯一 run ID。每组包含相同的六题；每次重复使用独立 run 和 trace，避免后一次覆盖前一次。模型执行 trace 与导出的实验 trace 是两条记录，实验输出中的 `traceId` 指向模型执行记录；完整工具参数/结果也保存在实验输出里。仅合成题允许进入本执行器。

## 六道题与标准答案

| 场景 | 必须读取的资料 | 最终 JSON 的事实 |
| --- | --- | --- |
| 公开网页 | 指定 URL，不调用项目文档工具 | `confidenceThresholdPercent: 86` |
| 旧网页 ID | 从真实 tool-result 历史恢复原 URL 再读，不使用旧 docId | `confidenceThresholdPercent: 86` |
| 七份项目文档 | 方案1.md 到方案7.md | `syncMinutes1..7` 分别为 `17,23,41,59,67,83,97` |
| 混合来源 | 方案1.md + 网页 | `syncMinutes1: 17`、`confidenceThresholdPercent: 86` |
| 可信项目文档 ID | 用目录定位方案1.md，允许直接读取 | `syncMinutes1: 17` |
| 失败后恢复 | 从失败的 tool-result 历史继续，重新定位并读取方案1.md | `syncMinutes1: 17` |

数字来自固定合成正文，不是模型裁判给出的答案。预期数字不会放入用户问题；只有响应字段名交给模型。错误历史也不会包含待回答的事实。可检查 `cases.ts` 对照正文与答案；修改题目或答案会改变 dataset revision。

## 如何看结果

每次 run 立即保存完整 JSON，全部完成后输出 `comparison.md` 和 `comparison.json`，目录为 `evals/agent/results/local/document-tools-*`（已被 Git 忽略）。即使 Langfuse 上传失败，已完成 run 的本地证据仍在。

| 分数 | 通过条件 |
| --- | --- |
| `document-id-source` | 不拿网页/Artifact/版本 ID 当项目文档 ID |
| `source-selection` | 不读取题目之外的来源；纯网页题不查项目文档 |
| `required-sources-read` | 所需项目文档和网页均成功读取 |
| `no-repeated-failure` | 不重复相同的失败工具和参数；命中失败缓存仍算模型重复误调 |
| `no-document-write` | 没有调用更新工具，包括参数错误而未执行的更新调用 |
| `valid-tool-inputs` | SDK 没有拒绝工具参数/工具名称 |
| `answer-facts` | 最终 JSON 每个字段对应正确数值，无缺项、额外项或串位 |

还复用框架的执行成功、非空输出和终态检查。答案数字正确但没有读取资料不算通过；读齐资料但答案串位也不算通过。基础设施异常单独展示，不把它解释成提示词效果。退出码为 1 表示新版至少一题未通过，或任一版本有执行异常；旧版正常执行后暴露的行为错误不会单独令命令失败。

## 对比边界

- `baseline.json` 的提示词、工具描述和 JSON Schema 来源于修复提交 `d28da92` 的父版本 `142e6a7911509e9aa336fa58fc0aa1555971c852`。参数验证也使用冻结的 schema，不随新版变化。旧工具失败返回“资源不存在”，网页结果保留 docId。
- `current` 在运行时读取当前工具描述和参数定义，使用当前恢复机制，网页结果不含 docId。实际生效的提示词/schema 会计算指纹，避免仅凭 Git HEAD 误标未提交变化。
- 这是**文档工具协议的受控对比**，不运行旧版全站，也不复现完整历史路由器。两版使用相同的多步循环、资料和生成预算；所有五个工具都可选，没有预先强制“正确工具”。
- 每轮交替先跑 baseline/current；每个模型独立汇总。三次重复只提供初步信号，不等于线上可靠性证明。
- 为了不用模型裁判，答案要求 JSON 数值映射。它验证这些题的资料事实，不验证开放式解释质量；格式错误会导致 `answer-facts` 失败，查看答案即可区分。后续仍需用真实长对话与隔离数据库验证生产链路。

## 无模型凭据时验证评测程序

```bash
pnpm test:agent-evals:documents
```

使用 AI SDK 的模拟模型执行真实多步工具循环，验证评分器、失败恢复、旧/新响应差异、重复轮次、调用证据和 Langfuse 导出合同。此命令通过只能说明评测程序正常，不能代替真实模型实验。原 `e2e/thread-chat/document-tool-model-eval.mjs` 已由上述入口替代。
