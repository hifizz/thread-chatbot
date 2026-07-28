# Graphiti / Zep：时序 Context Graph

> 源码快照：`getzep/graphiti@3bb2d0bba56f8e22311574c045452c420a012f49`（2026-07-23）。重点文件：[`graphiti_core/graphiti.py`](https://github.com/getzep/graphiti/blob/3bb2d0bba56f8e22311574c045452c420a012f49/graphiti_core/graphiti.py)、[`graphiti_core/edges.py`](https://github.com/getzep/graphiti/blob/3bb2d0bba56f8e22311574c045452c420a012f49/graphiti_core/edges.py)。

## Graphiti 与 Zep 不是同一个交付物

- **Graphiti**：开源 Python 时序图引擎；调用者自建用户、消息、图数据库与运维。
- **Zep**：托管 context infrastructure，使用其生产图引擎并提供 SDK、治理和运维能力。

不能把 Zep 的托管延迟或规模声明直接归因于自托管 Graphiti。

## 数据模型

Graphiti 的核心对象：

- `EpisodicNode`：原始输入，承担 provenance；
- `EntityNode`：人、地点、项目等实体；
- `EntityEdge`：实体之间的事实/关系；
- community/saga：更高层组织与连续 episode。

`EntityEdge` 源码字段直接体现 bi-temporal 设计：

```text
fact, fact_embedding, episodes
created_at, expired_at
valid_at, invalid_at
reference_time
source_node_uuid, target_node_uuid, group_id
```

`valid_at/invalid_at` 描述事实何时在现实中成立；`created_at/expired_at` 描述系统何时知道或使其失效；`episodes` 保留来源。

## 写入调用链

`Graphiti.add_episode()` 及其内部方法大致执行：

1. 保存带 `group_id`、`source_description`、`reference_time` 的 episode；
2. 读取前序 episodes 作为上下文；
3. LLM 结构化抽取 entity nodes；
4. `resolve_extracted_nodes()` 与图中实体去重；
5. LLM 抽取 relation edges 与属性；
6. `resolve_extracted_edges()` 处理重复与矛盾，返回 resolved、invalidated、new 三组边；
7. 为事实生成 embedding；
8. 批量保存 episode、entity、关系与 provenance edges；
9. 可选更新 community/saga 摘要。

源码提供 bulk 路径并使用 semaphore 控制并发。官方 README 明确说明 structured output 质量决定 ingestion 稳定性，小模型或仅“声称兼容 JSON schema”的 provider 可能失败。

## 读取路径

Graphiti 不是在查询时让 LLM 总结整张图，而是组合：

- fact/entity embedding 的语义检索；
- 全文/BM25；
- 图距离或节点邻接；
- 预设 search recipes 和 reranking。

检索结果是事实边/实体，LLM 只消费返回的 context。查询本身可以不调用 LLM，但写入已经付出多次 LLM 和 embedding 成本。

## 优点

- 时间语义、provenance 和历史保留是一等字段；
- 同一实体的演化比扁平向量条目更自然；
- hybrid retrieval 能回答关系和多跳问题；
- prescribed ontology 可用 Pydantic 约束实体/边类型。

## 成本与风险

- 需要 Python 服务和 Neo4j/FalkorDB/Neptune；当前项目只有 Postgres；
- 一个 episode 的写入包含多次结构化抽取、去重、关系消解和 embedding；
- `group_id` 是图分区，不自动等于应用的鉴权边界；
- LLM 仍参与实体/边消解，“自动失效”不等于永远正确；
- 项目当前需要的主要是少量用户当前值，图建模收益尚未覆盖运维复杂度。

## 对本项目的可复用点

不引入图数据库也应借用四个字段：

```text
valid_from / valid_to       # 现实有效时间
recorded_at                 # 系统观察时间
source_event_id             # provenance
supersedes_id               # 演化链
```

还应把“原始 episode”和“派生 fact”分开：抽取模型升级后可从 episode 重算事实，而不丢原始证据。

## 何时再考虑 Graphiti

满足以下至少两项再评估：

- 需要跨用户/组织实体关系；
- 多跳关系查询是主要产品能力；
- 需要回答历史时点真值；
- 单用户事实量已让关系表查询变得笨重；
- 团队能承担独立 Python/graph 服务。

## 判定

**暂缓。** 学习其 bi-temporal 与 provenance 设计，但第一版用 Postgres 版本化事实表实现相同的关键不变量。
