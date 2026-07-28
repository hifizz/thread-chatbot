# Memobase：缓冲写入、画像与事件时间线

> 源码/文档快照：`memodb-io/memobase@358c16bbc6d687937d79bc2f984a11c3be8da901`（2026-01-11）。入口：[仓库 README](https://github.com/memodb-io/memobase/tree/358c16bbc6d687937d79bc2f984a11c3be8da901)。

## 设计动机

Memobase 的口号是 “Memory for User, not Agent”。它不让每条聊天立刻进入 agentic tool loop，而是维护：

- 用户 blob buffer；
- topic/sub-topic 结构化 profile；
- 带时间的 event timeline；
- 把画像与事件打包进 prompt 的 `context()`。

它解决的是在线产品的稳定个性化，而不是让 agent 自主维护任意知识。

## 调用链

公开 API 展示的路径：

```text
u.insert(ChatBlob(messages))
  -> blob 进入该用户 buffer
  -> 达到阈值 / 闲置超时 / 手动 u.flush()
  -> 后台工作流批量抽取与更新
  -> profile(topic, sub_topic, content) + events

u.context(max_token_size, prefer_topics)
  -> SQL 读取预计算结果
  -> 按预算打包 user background + latest events
  -> 注入聊天 prompt
```

默认异步 flush；README 给出的典型触发值是约 1024 tokens 或闲置约 1 小时，也允许在会话结束时手动 flush。处理后的原始 blob 默认可删除，是否留存由配置控制。

## 为什么 buffer 很重要

每轮都抽取会造成：

- LLM 固定开销被短消息放大；
- 同一话题被多次拆成碎片；
- 写入延迟落在用户等待路径；
- 多个并发 turn 更容易发生旧结果覆盖新结果。

缓冲让模型一次看到一个较完整的局部情境，成本按多轮摊薄。代价是 eventual consistency：刚说完的信息可能暂时没有进入 profile。

## 画像 schema

Profile 以 `topic/sub_topic/content` 组织，例如：

```text
basic_info.name
interest.games
work.title
psychological.goals
```

这比无 schema 的向量条目更适合：

- 直接构造 system prompt；
- 产品 UI 按分类展示；
- SQL 过滤或分析；
- 限制哪些信息允许被记住。

但开放式 topic 仍会漂移。项目落地时应先固定少量 predicate，不直接复制大而全的人格画像分类。

## 读取语义

常规 `profile()` 是预计算结果，读取便宜；`context()` 负责 token budget、topic 偏好和事件打包。README 同时说明较新 context 搜索可能调用 embedding、耗时高于单纯 profile 读取。两者不应混称为同一延迟。

## 可复用点

- 写入脱离热路径；
- buffer 以 token 和 idle time 双阈值触发；
- 画像与事件分层：稳定属性常驻，长尾经历按需；
- 注入 API 自带预算，而不是把整张画像无限拼接；
- profile schema 同时服务模型和用户控制面。

## 不直接接入的原因

- 需要独立 FastAPI/Postgres/Redis 服务或托管 API；
- 本项目已经有 Postgres、鉴权和 embedding，双写另一套用户系统会增加一致性成本；
- 厂商自报的 LOCOMO/延迟不能替代本项目数据上的验证；
- 泛化画像类别可能收集超出产品必要范围的敏感信息。

## 本项目落地映射

建议复制其节奏，而不是 SDK：

```text
memory_events(status=pending)
  -> 每用户 token_count >= N 或 oldest_event_age >= T
  -> extraction_run
  -> facts transaction
  -> profile refresh
```

阶段 3 先测试 `N=4~8 turns` 和会话结束 flush；不要先锁死 1024 tokens/1 小时，这些数值没有本项目证据。

## 判定

**重点借鉴。** 在所有外部方案中，它与“用户画像 + 低在线延迟 + 自有 Postgres”的产品目标最接近。
