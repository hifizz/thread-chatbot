## 1. 前置验收与来源模型

- [ ] 1.1 确认 `add-proactive-web-search` 已通过 GLM-5.2、计费和灰度门槛；否则保持 Web Fetch flag 关闭
- [ ] 1.2 定义 response-local source ledger、opaque `sourceId`、compact persisted source 和 `readSource` 输入/结果的共享类型与 schema
- [ ] 1.3 扩展 Thread Chat 消息/树 sanitize 与持久化，旧消息无 sources 时兼容，限制每条消息来源数且不保存全文

## 2. URL 与提取安全边界

- [ ] 2.1 完成共享 public-web URL validator，覆盖 scheme、credentials、host、port、local/private/link-local/reserved IP literal 和 canonical URL
- [ ] 2.2 在搜索结果注册阶段分配 sourceId，在 `readSource` execute 内仅从同一请求 ledger 解析，未知/跨请求 ID 不访问 provider
- [ ] 2.3 为托管 extract 增加超时、文本 content type、响应/字符大小、6,000 字符上下文、截断标记和错误分类
- [ ] 2.4 验证当前 provider 返回 URL/元数据与注册来源一致；任何直接网络 fetch 或无法安全验证的重定向实现留在本 change 范围外
- [ ] 2.5 将提取文本包裹为不可信证据并过滤二进制/脚本控制信息，system/tool prompt 明确禁止遵循页面内工具/导航/泄密指令

## 3. 有界 `readSource` 工具循环

- [ ] 3.1 实现请求内 fetch budget：默认 1 次、绝对最多 2 次，在 provider 调用前占用并覆盖并行调用
- [ ] 3.2 把 `readSource` 加入 Thread Chat `activeTools/prepareStep`，仅在已有可读 sourceId 时开放，并保持搜索、Markdown Artifact 和总 step 上限一致
- [ ] 3.3 对 unsafe、timeout、empty、unsupported、provider error 和 budget exhausted 返回结构化结果，让 GLM-5.2 降级到搜索快照并披露限制

## 4. 结构化来源与引用 UI

- [ ] 4.1 扩展 UI stream 消费器，窄解析 search/readSource 结果并增量构建当前 assistant 消息的 compact source ledger
- [ ] 4.2 定义并解析持久化 inline source marker（如 `[[cite:<sourceId>]]`），按出现顺序渲染数字 tag；只有 sourceId 匹配 message ledger 时标记为 retrieved
- [ ] 4.3 将有效 tag 渲染为可 hover/focus 的可访问链接，展示标题/域名/摘要，并用 `target="_blank" rel="noopener noreferrer"` 打开 canonical URL 新 tab
- [ ] 4.4 实现引用位置规则：默认事实句/主张末尾，精确版本/日期/值可放实体后，同源支撑整段时可放段末，多来源可并列/分组，禁止给普通名词过度标注
- [ ] 4.5 保存/重载 source ledger 与 marker 精确位置；未知/损坏 sourceId 显示不可点击“来源不可验证”，且搜索/提取全文不进入树 JSON
- [ ] 4.6 更新 system prompt，要求材料事实就近引用一手来源、冲突并列、无支持时不附无关 tag，并保留紧凑来源列表

## 5. Fetch 计费与审计

- [ ] 5.1 扩展外部用量 ledger 支持 `extract` 的 units、返回字符、latency/status/cost/price 和 idempotency
- [ ] 5.2 按 provider-reported/reconciled Extract usage 收费；缺少 usage 时仅对单 URL 成功请求临时保守预留 1 credit 并可对账修正，验证 search + extract + model 聚合不重不漏
- [ ] 5.3 在 UI 显示“读取来源”成本/预算状态，并对失败但 provider 未计费和已计费两种情况分别验证

## 6. 验证与发布

- [ ] 6.1 用 fixtures 覆盖 sourceId 隔离、恶意 URL、提示注入、超长/二进制内容、并行预算、取消和失败降级
- [ ] 6.2 增加消息 sources/markers 的 sanitize/save/reload/旧数据兼容、ledger 匹配、无效 ID、安全新 tab 属性、hover/focus 与键盘访问测试
- [ ] 6.3 用固定 GLM-5.2 编程集分别评估 citation validity/placement/correctness/completeness、深读触发率、延迟、调用数和费用
- [ ] 6.4 运行 `pnpm typecheck`、`pnpm lint`、相关 e2e、`pnpm build` 和 `openspec validate add-controlled-web-fetch --strict`
- [ ] 6.5 内部开启后再小比例灰度；指标异常时关闭 fetch flag，确认搜索-only 回退及历史 source cards 仍可用

## 7. Research 与 ADR 维护

- [ ] 7.1 将 provider 实际 Extract usage、失败计费、SSRF/注入测试和 citation 分项评测结果回填 `research/README.md`
- [ ] 7.2 OpenSpec 获批后更新 ADR 状态；source marker、provider fetch 或安全边界若改变，新增 superseding ADR 并同步 specs
