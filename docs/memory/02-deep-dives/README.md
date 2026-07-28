# 阶段 2：逐方案深入

> 研究快照：2026-07-24。本文档集完成 PR [#2](https://github.com/hifizz/thread-chatbot/pull/2) 中“每个代表方案一篇：设计动机、架构、源码级实现细节”的任务。外部项目仍在快速变化，引用的主干快照与关键文件均在各篇中标明。

## 结论先行

本项目不应直接引入某个通用记忆框架作为核心依赖。优先进入实验的是：

1. 以现有 Postgres、Drizzle、pgvector 为底座，自建“结构化事实 + 事件时间线 + 可选向量召回”；
2. 写入采用 Memobase 的缓冲思想，但事实冲突由 schema 和确定性版本规则处理；
3. 读取采用“紧凑画像常驻 + 精确事实查询 + 长尾语义召回”的分层组合；
4. 借鉴 ChatGPT 的可审计控制面和 Anthropic memory tool 的受限 CRUD 协议；
5. 暂不引入 Graphiti、LangMem、Letta 或 Mem0 运行时；它们分别带来图数据库、Python/LangGraph、外部 agent runtime 或不可控写入语义。

这只是阶段 2 的架构决策，不等于已经实现产品记忆。数据表、写入任务、注入与 UI 属于阶段 3/4。

## 文档导航

| 文档 | 重点 | 对本项目的判定 |
| --- | --- | --- |
| [01-self-built-postgres.md](./01-self-built-postgres.md) | 基于当前源码的目标架构与挂载点 | **进入实验** |
| [02-mem0.md](./02-mem0.md) | V3 ADD-only 管线、检索、作用域 | 借鉴，不接入 |
| [03-anthropic-memory-tool.md](./03-anthropic-memory-tool.md) | 文件式 JIT 记忆协议与安全边界 | 借鉴工具协议 |
| [04-graphiti.md](./04-graphiti.md) | bi-temporal 图、写入与混合检索 | 暂缓 |
| [05-langmem.md](./05-langmem.md) | hot path 工具、后台 manager、提示优化 | 借鉴 manager |
| [06-memobase.md](./06-memobase.md) | 缓冲写入、画像、事件、context 注入 | **重点借鉴** |
| [07-letta.md](./07-letta.md) | core blocks、archival memory、sleeptime | 不接入 |
| [08-chatgpt-memory.md](./08-chatgpt-memory.md) | 产品行为、后台 synthesis、用户控制面 | **重点借鉴 UX** |
| [09-evaluation.md](./09-evaluation.md) | 评测边界与阶段 3 最小实验集 | **阶段 3 输入** |

## 横向比较

| 方案 | 主存储形态 | 写入控制者 | 冲突/时间 | 读取路径 | 接入摩擦 |
| --- | --- | --- | --- | --- | --- |
| 自建 Postgres | 关系表 + 可选 vector | 应用管线 | schema + 版本链 | SQL + vector | 低 |
| Mem0 V3 | 向量条目 + links + history | 单次 LLM 抽取 | 新记忆关联旧记忆 | 多信号检索 | 中 |
| Anthropic tool | 客户端文件/自定义存储 | Claude 工具调用 | 文件编辑语义 | 按需 `view` | 中；模型绑定 |
| Graphiti | 实体/事实边/episode 图 | 多阶段 LLM 管线 | `valid_at`/`invalid_at` | 语义 + BM25 + 图 | 高 |
| LangMem | LangGraph BaseStore | agent 工具或 manager | LLM update/delete | store search/注入 | 高；Python |
| Memobase | 画像 + 事件 + buffer | 后台固定工作流 | 画像更新 + timeline | `context()` | 中 |
| Letta | core blocks + archival | 主 agent/后台 agent | block 自编辑 | 常驻 + 检索 | 高；runtime 替换 |
| ChatGPT | 未公开 | 后台 synthesis | 持续重写、时间演化 | 产品内部 | 不可接入 |

## 研究方法与证据边界

- 优先读官方仓库、官方文档与当前项目源码，而不是二手博客。
- “源码级”表示定位到数据模型、入口函数、关键 prompt 或 tool schema；不把厂商性能数字当作独立证据。
- 闭源产品只能做行为层分析。`08-chatgpt-memory.md` 明确区分官方披露与推断，不伪造内部实现。
- 每篇都包含“可复用点 / 不可照搬点 / 对本项目结论”，保证调研能直接进入实验设计。

## 阶段 2 验收

- [x] 覆盖 PR #2/`01-survey.md` 阶段 2 清单中的代表方案
- [x] 对快速变化的 Mem0、Letta 做版本修正
- [x] 给出本项目当前源码的注入、写入和存储挂载点
- [x] 给出阶段 3 的可执行实验集与成功门槛
- [x] 更新总入口的阶段状态与阅读导航
