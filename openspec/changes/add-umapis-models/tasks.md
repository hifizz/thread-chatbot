## 1. 上游协议确认

- [x] 1.1 使用两组有效测试凭据确认 Base URL、`/v1/chat/completions`、Bearer 鉴权、四个模型 id、默认流式文本/usage/reasoning 形态，并将脱敏记录写入 change 目录；Effort 参数尚未确认且按当前范围不发送

## 2. 模型注册与 UMAPIS provider

- [x] 2.1 扩展统一模型类型，加入 UMAPIS provider、Claude/GPT 凭据组和未计费预览标记
- [x] 2.2 注册 claude-opus-4-6、claude-sonnet-5、gpt-5.6-sol、gpt-5.6-terra，使其出现在 Thread Chat Prompt 输入关联的模型选择器且不改变既有默认模型与历史 id
- [x] 2.3 新增 UMAPIS adapter，读取两组 Key 与可选 Base URL，按已验证的 OpenAI-compatible 默认协议创建 AI SDK 模型，不映射 Effort provider options
- [x] 2.4 在统一 provider 解析层加入按凭据组的可用性判断和专属短路，确保现有 MiniMax、Ark、Vercel、Cloudflare 与供应商直连路径不变
- [x] 2.5 在 `.env.example` 与中英文 README 说明两组 UMAPIS 配置、四个预览模型、默认调用、未配置错误及“计费/Effort 留待后续 spec”的边界

## 3. 请求链路与未计费预览隔离

- [x] 3.1 保持 Thread Prompt 输入的既有模型选择、分支锁定、历史数据和请求编译逻辑；UMAPIS 请求不携带 Effort
- [x] 3.2 明确标记 UMAPIS 模型为未计费预览，确保其不受余额拦截、不扣用户付费额度、不写扣费流水且不展示虚构单价，同时保留可用 token usage
- [x] 3.3 验证 UMAPIS 的标准 reasoning/usage 流直接透传，并回归工具调用与 Markdown Artifact 终止条件

## 4. 验收

- [x] 4.1 为注册表可见性、凭据组、Base URL 规范化和未计费预览边界补充自动化测试
- [x] 4.2 运行格式化、lint、typecheck、build、OpenSpec strict validation 及相关自动化测试，修复所有本变更引入的问题
- [x] 4.3 使用四个模型逐一完成真实默认流式 smoke，并确认缺少对应组 Key 和现有 provider 回归场景
- [x] 4.4 在验收记录中列出后续 billing/Effort spec 的输入：UMAPIS 官方价格、Effort 参数与计费影响、汇率/利润、额度策略、并发敞口与真实成本对账；本 change 到此结束，不实现这些事项
