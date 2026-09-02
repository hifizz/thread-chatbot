# Search provider attempt 观测

所有真实 Web provider 调用都通过 `runProviderAttempt`。当前 AnySearch Search 与 Extract 已接入；未来 Parallel、Firecrawl、Exa 或 provider router adapter 复用同一入口，不再维护另一套日志字段。

每个 attempt 记录：

- 当前 Trace/父 Observation（存在 active context 时）；
- provider、`search/fetch/extract` operation、route reason；
- attempt index、fallback count、outcome、duration；
- provider 原始计量单位、数量及是否估算；
- Search 结果数或 Extract 字符数；
- timeout、rate limit、authentication、provider、empty/unusable、cancel、budget exhausted 等安全分类。

development 的简洁日志与 Langfuse child Observation 消费同一个事件对象。生产不额外输出该 console 日志，结构化事件通过 Agent Trace 上的 `search.provider-attempt.*` Observation 查看。

## 隐私边界

attempt schema 本身不提供 headers、credential、query/URL 原文、页面正文、snippet 或 provider payload 字段。Search 输入只保留规范化 SHA-256 fingerprint；Fetch 只保留 hostname。即使 adapter 得到完整输入，也只能把 fingerprint/domain 交给 sink。统一 Langfuse exporter mask 仍是第二道保护。

## 测试

`pnpm test:observability:provider-attempt` 使用 fake provider、内存 Trace backend 和事件 consumer，覆盖 Search/Extract 成功、401、429、5xx、timeout、cancel、empty、unusable、budget exhausted 与 fallback 链路，并断言敏感 query、URL、正文和 provider payload 不会进入事件。
