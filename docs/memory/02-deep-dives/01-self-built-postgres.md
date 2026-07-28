# 自建 Postgres 路线：本项目的候选蓝本

## 为什么它是首选

当前项目已经具备这条路线最贵的基础设施：

- [`lib/db/schema.ts`](../../../lib/db/schema.ts) 已使用 Drizzle/Postgres，并有 `vector(1536)` 与 HNSW 索引；
- [`lib/ai/embeddings.ts`](https://github.com/hifizz/thread-chatbot/blob/main/lib/ai/embeddings.ts) 已封装 OpenAI-compatible embedding；
- [`lib/chat/retrieve.ts`](https://github.com/hifizz/thread-chatbot/blob/main/lib/chat/retrieve.ts) 已实现 cosine 检索；
- [`app/api/chat/route.ts`](../../../app/api/chat/route.ts) 已有用户身份、服务端 system prompt、`prepareStep`、`onFinish` 和 `after()`；
- 分支聊天树已经整体持久化，但它保存的是会话状态，不是跨树共享的用户事实。

因此“自建”不是从零实现向量数据库，而是给现有数据层增加正确的记忆语义。

## 现有 RAG 可以复用什么

附件 RAG 的链路是：

```text
PDF pages
  -> chunkPages(size=1000, overlap=150)
  -> embedMany
  -> attachment_chunks + HNSW
  -> embedQuery
  -> cosine top-k
  -> 带页码片段注入消息
```

可复用：embedding provider、批量写入、HNSW 建索引方式、相似度查询和失败降级。

不可直接复用：

- `attachment_chunks` 以 `attachment_id` 分区，记忆必须以 `user_id` 为第一隔离边界；
- 文档块是 append/replace 内容，事实需要来源、置信度、有效时间、撤销和用户编辑；
- `gt(similarity, 0)` 对文档兜底可以接受，对用户记忆召回过宽；
- `EMBEDDING_DIMENSIONS=1536` 是数据库契约，更换模型不能只改环境变量；
- 向量近邻不能可靠完成“用户现在住哪里”这类当前值查询。

## 目标数据模型

建议阶段 3 先验证四层，不一次性做完整产品表：

```text
memory_events
  id, user_id, source_tree_id, source_message_id
  observed_at, payload, extraction_version

memory_facts
  id, user_id, subject, predicate, value_json
  valid_from, valid_to, status, confidence
  source_event_id, supersedes_id, created_at, updated_at

memory_profiles
  user_id, profile_json, version, refreshed_at

memory_embeddings (可选)
  fact_id, embedding, searchable_text
```

关键不变量：

1. 所有查询必须显式带 `user_id`；
2. 事实来源不可丢，用户能追溯到树和消息；
3. 当前值由 `status/valid_to/supersedes_id` 和 SQL 决定，不让 LLM 临场猜；
4. 删除默认先做可审计的失效，隐私删除再做物理清理；
5. embedding 是事实的索引，不是事实本体。

## 写入路径

```text
assistant 流完成
  -> 记录待处理 event（幂等键 = source_message_id + extractor_version）
  -> 后台/缓冲任务读取若干新 turn
  -> LLM 输出受 schema 约束的候选事实
  -> 确定性校验（作用域、敏感字段、枚举、时间）
  -> 按 (user, subject, predicate) 查当前值
  -> ADD / supersede / ignore
  -> 异步生成 embedding 与刷新 profile
```

`onFinish` 当前承担计费，不能把昂贵抽取直接塞进去。`after()` 只保证请求后的工作有机会完成，不是持久队列；阶段 3 可以用它做最小实验，生产实现要有持久状态、重试和幂等。

写入不应默认记住 assistant 的所有回答。第一版只抽取用户明确陈述和明确“请记住”的内容；assistant 生成的计划另设 `kind`，避免把模型幻觉升级成用户事实。

## 读取与注入路径

每次请求建议只做一次读：

1. SQL 获取紧凑画像和与问题中明确实体匹配的当前事实；
2. 若问题需要长尾回忆，再对 active facts/events 做向量召回；
3. 按固定 token/字符预算打包；
4. 拼入 [`app/api/chat/route.ts`](../../../app/api/chat/route.ts) 的服务端 `system`。

`prepareStep` 适合“模型在本轮调用记忆工具后，需要让下一步看到最新记忆”的场景。若记忆只在请求开始前读取，直接构造 `system` 更简单，也避免每个 tool step 重复查库。AI SDK v7 源码显示 `prepareStep` 返回的 `instructions/messages` 会传递到后续步骤，实施时必须避免重复追加同一 memory block。

建议注入格式：

```xml
<user_memory generated_at="...">
  <instruction>仅在与当前问题相关时使用；不得把记忆当作用户本轮明确陈述。</instruction>
  <profile>...</profile>
  <facts>...</facts>
  <episodes>...</episodes>
</user_memory>
```

## 用户控制面

最小可用 UI 必须同时交付：

- 查看记忆、来源与最近更新时间；
- 编辑当前值并标记为用户确认；
- 删除单条/清空全部；
- 关闭自动记忆或使用临时聊天；
- 在回答旁解释“本次使用了哪些记忆”。

没有控制面就不应默认上线自动写入，因为错误记忆和投毒会跨会话持续生效。

## 阶段 3 的最小切片

先只做 `preferred_language`、`dietary_restriction`、`current_project` 三类 predicate：

- 结构固定，容易验证冲突；
- 能覆盖偏好、敏感约束和短期状态；
- 不需要一开始就做通用 ontology；
- 可直接比较“全上下文 / 纯向量 / 结构化事实”三条路线。

## 判定

**进入实验。** 技术栈匹配、数据主权最好，也最符合阶段 1 对确定性新鲜度消解的结论。主要风险不在数据库，而在抽取质量、后台可靠性、隐私控制和 schema 演进。
