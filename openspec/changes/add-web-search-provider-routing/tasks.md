## 1. 已验证的 Fast Demo 基线（保留原记录）

- [x] 1.1 接入 AnySearch REST Search 与 MCP Extract，并将结果归一化为现有 Search/Fetch 返回结构。
- [x] 1.2 通过 webSearch/readUrl 接入四态路由、Research Planner、多步工具循环、联网活动 UI 与消息持久化。
- [x] 1.3 在开发环境请求前输出实际 provider/operation，且不记录 credential 或正文。
- [x] 1.4 将 demo、智能路由和 2026-08-19 调研记录到 docs/deep-research。

以上是原 change 已有完成标记，不表示本次重新执行了验收。下面任务全部待实现。

## 2. 契约与路由

- [ ] 2.1 实现 Search/Fetch adapter、descriptor、SearchExecutionContext、AttemptResult 和 runtime validation。
- [ ] 2.2 收口 AnySearch 适配，分开开发匿名策略与生产采购准入，不依赖恒真配置检测。
- [ ] 2.3 接入 server-only registry/router，保持模型工具/UIMessage/来源兼容并拒绝客户端 provider override。

## 3. 可靠性与状态

- [ ] 3.1 统一 effectiveDeadlineAt、Generation/研究模式/lease/收尾预算，消除 5/15 分钟边界冲突。
- [ ] 3.2 实现错误分类、有限重试、Retry-After、熔断、主备顺序与取消传播。
- [ ] 3.3 分开 socket 断连与明确 Stop，验证刷新后继续及双实例状态恢复。

## 4. 安全与证据复用

- [ ] 4.1 校验 URL/protocol/credential/IP/DNS/redirect、响应类型和大小，落实抓取端边界。
- [ ] 4.2 采用不可信证据包装，验证 prompt injection 不改变权限。
- [ ] 4.3 实现请求内去重、新鲜度缓存与 owner/generation 绑定的共享 cursor 快照、TTL 清理。

## 5. 计量与预算

- [ ] 5.1 复用 #164 的 ledger/usage/reservation/price snapshot，将 Search/Fetch 原单位完整映射。
- [ ] 5.2 实现 provider account 共享日/月预算与 QPS，聚合表只作运营汇总而非第二扣款源。
- [ ] 5.3 保存失败/备用/未知用量；测试 batch、缓存续读和并发去重不重复收费。
- [ ] 5.4 schema 变更仅在独立库 db:push，由 develop 单一集成任务生成并验证 migration。

## 6. 观测

- [ ] 6.1 接入既有 Axiom/Langfuse attempt 事件，绑定 Generation/trace/release/账务，不新建日志平台。
- [ ] 6.2 测试脱敏、完整调用链、未知费用、低额度、401/429/预算与供应商同步失效告警。

## 7. 付费主备

- [ ] 7.1 为 Parallel Search/Extract 和 Exa 建立薄 adapter/合同测试，复用现有 Exa 正文能力；初始 flag 关闭。
- [ ] 7.2 完成每家采购清单：价格/原单位/容量/QPS/数据政策/提额/余额告警及账号确认时间。
- [ ] 7.3 同题比较后批准一个主和一个备用；没有证据不得默认生产可用。

## 8. 延后范围说明

Firecrawl 动态页及 Valyu/Brave/Serper 垂直/传统 SERP 扩展延后，不作为 Beta 阻塞任务；以后仍需相同接入验收。不得为占位注册未实现 adapter，禁止多账号/key 规避额度。

## 9. 评测

- [ ] 9.1 复用 evals/agent runner/manifest，覆盖中英文、直接 URL、长文、时效及不应联网场景。
- [ ] 9.2 固定候选 fingerprint，同题保存质量/引用/延迟/成本/计量覆盖，不只比较 HTTP 200。
- [ ] 9.3 运行真实主/备调用和 429/timeout/空结果/无 key/SSRF/双实例预算/游标故障测试。

## 10. 上线与回滚

- [ ] 10.1 小批次启用已批准付费策略，冻结阈值并观察质量、p95、成本和额度。
- [ ] 10.2 演练回滚到已核验配置或安全关闭新联网，不回退为匿名无限假设。
- [ ] 10.3 更新服务商采购/环境变量/告警/成本/恢复 runbook。

## 11. 完整验收

- [ ] 11.1 运行 adapter/router/URL/计量/状态/兼容测试及项目 typecheck、lint、相关 build，区分既有失败。
- [ ] 11.2 执行 git diff --check 和 pnpm exec openspec validate add-web-search-provider-routing --strict。
- [ ] 11.3 桌面/手机验证搜索活动、来源、刷新/续读及清晰的不可用提示。

旧版 5.2 的功能分支直接生成迁移改为 develop 集成；旧版 8/9 的扩展 provider 延后；旧版 10.2 不新建 runner。已完成历史事项没有撤销或重新宣称完成。
