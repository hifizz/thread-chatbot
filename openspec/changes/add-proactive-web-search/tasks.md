## 1. 基线与开关

- [x] 1.1 将已验证的 GLM-5.2 中英双语工具路由样例整理为至少 60 条固定评测集，并记录当前无搜索、现有重型搜索的答案/调用数/用量/延迟基线
- [x] 1.2 定义 Auto Search 独立服务端 feature flag、灰度比例和紧急关闭语义，默认在生产关闭、开发内部开启
- [x] 1.3 核对现有 Tavily 配置和当前官方 credit 口径，只记录环境变量名称与套餐单价，不输出或落库 secret

## 2. 轻量搜索领域层

- [x] 2.1 在 `constants/` 建立 Auto Search 的模式、结果数、snippet、查询长度、超时、调用上限与 Basic credit 成本单一来源，并与 Deep Research 常量分离
- [x] 2.2 将 `lib/ai/search.ts` 的 Tavily wire format 封装为轻量搜索函数：basic/fast 档、`include_answer=false`、最多 3 结果、明确超时和分类错误
- [x] 2.3 实现公共 URL 规范化/过滤与 canonical 去重，覆盖非法 scheme、凭据、私网/环回/link-local IP literal、重复 URL 和长 snippet
- [x] 2.4 实现请求内搜索预算对象和 Auto Search 工具工厂，在 provider fetch 前占用单位，并对并行/超额调用返回结构化错误
- [x] 2.5 为工具输入使用严格 Zod schema、trim/长度校验和有限参数修复策略，验证 `query:null`、空串和超长查询不会发起 provider 请求

## 3. 外部调用计费

- [x] 3.1 设计并添加外部工具用量表及 Drizzle migration，字段覆盖关联 ID、provider/operation/status/units/cost/price/latency/result count/fingerprint/idempotency key
- [x] 3.2 在 `constants/pricing.ts` 增加 Tavily credit 的保守成本换算，复用微元、汇率和利润率函数并补纯函数验证
- [x] 3.3 实现幂等 `chargeExternalUsage`：扣费与流水同事务，成功/失败/免费额度的 shadow cost 语义符合 spec
- [x] 3.4 扩展账单汇总与 assistant 消息 usage metadata，把模型与搜索费用各计一次并保持旧消息兼容

## 4. GLM-5.2 工具循环与 Prompt

- [x] 4.1 扩展 `/api/chat` 请求校验和 Thread Chat request builder，支持 `auto|always|off` 且新会话默认 `auto`
- [x] 4.2 将服务器当前 ISO 日期/时区、必须搜索/不应搜索规则、一手来源偏好、提示注入与引用限制加入 Thread Chat system builder
- [x] 4.3 重构 `allTools/prepareStep/stopWhen`，让 `webSearch` 与 `createMarkdownArtifact` 共存；`always` 只强制首步，`off` 不暴露搜索，Deep Research 保持显式独立
- [x] 4.4 将搜索 provider 的 missing config、timeout、429、5xx、空结果、全过滤和 budget exhausted 转为模型可理解的降级结果，不伪造来源或中断普通回答
- [ ] 4.5 验证客户端断连后的 `consumeStream`、模型总用量和逐次搜索收费仍完整且不重复
  - 待补真实断连集成验证；当前只有流消费实现和计费幂等纯函数验证。
- [x] 4.6 提供仅非生产环境可显式开启的高搜索预算（最多 10 次串行调用与 11 个 step），用于 GLM-5.2 auto 行为评测；生产仍固定 2 次，单 step 仍固定 1 次

## 5. Thread Chat 透明 UI

- [x] 5.1 扩展 `app/thread-chat/net/ui-stream.ts` 的窄类型守卫和 handlers，解析 Web Search start/input/output/error，继续忽略未知/损坏工具事件
- [x] 5.2 在当前 assistant 消息显示查询、进行中、结果数、耗时与失败状态，且不暴露 provider payload、headers 或 secret
- [x] 5.3 将搜索进度设计为不持久化状态；确认完成回答的 Markdown 来源链接正常保存、reload 后无幽灵搜索状态
- [x] 5.4 增加用户可见的 `auto|always|off` 控件与费用提示，并保证每棵树/新会话的默认和持久化语义明确
- [x] 5.5 收敛活动卡溢出、`mb-6` 间距、静态搜索图标、查询中文字 shimmer 与来源展示：长 query/标题不越界，正文来源用发布者短名胶囊，已有可信引用时不再追加重复 footer
- [x] 5.6 持久化完成/失败的搜索聚合卡及其流顺序 offset，刷新后恢复原位；继续剥离进行中状态并补离线 reload 回归

## 6. 自动化验证

- [x] 6.1 用现有 `node:test`/fixture 风格覆盖模式校验、日期 prompt、URL 过滤、snippet 截断、并行预算、错误分类和外部计费幂等
- [ ] 6.2 增加 mock provider 的 `/api/chat`/UI stream 集成验证：0、1、2、超额、失败搜索及 search→Markdown Artifact 同轮流程
  - 工具层、UI stream 和策略测试已覆盖主要分支；仍缺真实 `/api/chat` route 的端到端 mock harness。
- [ ] 6.3 回归现有 Markdown Artifact、分支持久化、模型选择、停止生成和 Deep Research 行为，确认新 `activeTools` 不吞掉旧工具
  - Markdown Artifact 状态和模型选择已通过；停止生成、分支 reload 和 Deep Research 仍待完整回归。
- [x] 6.4 运行 60 条 GLM-5.2 路由集和至少 20 条真实 Tavily 编程集，生成决策、来源、正确性、延迟、请求数和费用报告并核对 launch gates
  - 路由/调用/来源 gate 通过；人工正确性/不退化 gate 未通过，生产发布保持阻断。

## 7. 发布与验收

- [ ] 7.1 运行 `pnpm typecheck`、`pnpm lint`、相关 e2e 脚本、`pnpm build` 和 `openspec validate add-proactive-web-search --strict`
  - typecheck、41 个变更文件聚焦 lint、相关离线 e2e 和严格校验通过；全仓 lint 被既有无关错误阻断，build 在 Docker/本机卡死期间中止，待重启后重跑。
- [ ] 7.2 在内部环境核对 Tavily 控制台 credits、外部用量流水、用户余额和消息费用汇总一致
  - migration 未应用；按用户要求等待 Docker/电脑重启后继续，不再执行相关测试。
- [ ] 7.3 按 feature flag 小比例灰度，监控触发率、每轮调用数、p95 延迟、错误、来源有效率和成本；记录扩大或回滚决定
  - 人工正确性 gate 未通过，生产默认关闭，尚未授权或执行灰度。

## 8. Research 与 ADR 维护

- [ ] 8.1 将最终 GLM-5.2 eval 报告、Tavily usage/账单核对和灰度数据回填 `research/README.md`，注明日期、环境、样本和局限
  - eval 和本轮约 29 credits 已回填；provider 控制台账单与灰度数据须在 7.2/7.3 完成后补录。
- [x] 8.2 OpenSpec 获批后将已采纳 ADR 标为 `Accepted`；任何实现期决策变化新增 superseding ADR，不覆盖原始记录
