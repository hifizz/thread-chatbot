## 1. 上游协议确认

- [ ] 1.1 取得 UMAPIS 官方 API 文档或有效测试凭据，确认 Base URL、聊天路径、鉴权、四个模型 id、每个模型的 Effort 参数名/允许值/默认值、reasoning 响应形态与 usage 字段；将验证结果记录在 change 目录，任一关键项无法确认时停止后续实现而不猜测
- [ ] 1.2 用最小 curl 或 SDK 请求分别验证一个 Claude 与一个 GPT 模型的默认及非默认 Effort，记录脱敏请求、流式响应形态和失败状态码

## 2. 模型注册与 UMAPIS provider

- [ ] 2.1 扩展统一模型类型，加入 UMAPIS provider 以及按模型声明的 Effort 选项、默认值和上游映射，并实现可复用的 model+effort 解析纯函数
- [ ] 2.2 注册 claude-opus-4-6、claude-sonnet-5、gpt-5.6-sol、gpt-5.6-terra，将其纳入 Thread Chat 可选集合且不改变既有默认模型与历史 id
- [ ] 2.3 新增 UMAPIS adapter，读取 UMAPIS_API_KEY 与可选 UMAPIS_BASE_URL，按 1.1 已确认的协议创建 AI SDK 模型并集中映射 Effort provider options
- [ ] 2.4 在统一 provider 解析层加入 UMAPIS 可用性判断和专属短路，确保现有 MiniMax、Ark、Vercel、Cloudflare 与供应商直连路径不变
- [ ] 2.5 在 .env.example 与中英文 README 说明 UMAPIS 配置、四个预览模型、Effort 能力、未配置错误及“计费留待后续 spec”的边界

## 3. Thread Effort 领域状态

- [ ] 3.1 为 Thread 类型、默认 seed 和分支创建逻辑增加 Effort；新分支同时继承父 Thread 的 modelId 与已解析 Effort
- [ ] 3.2 为 Thread store 增加受模型允许列表约束的 Effort setter，并让模型切换执行“共同值保持，否则默认回退/清除”
- [ ] 3.3 扩展历史整树 sanitizer，对缺失、未知、与模型错配的 Effort 做确定性默认回填或清除，保持旧树无需数据库迁移即可加载
- [ ] 3.4 为 Effort 解析、模型切换、分支继承和历史数据清洗补充自动化测试，覆盖 Claude/GPT 不同支持集及非 Effort 模型

## 4. 选择器与请求链路

- [ ] 4.1 从统一注册表向 Thread ModelSelector 传入每个模型的 Effort 选项与默认值，复用现有 Effort compound UI，并在无选项时隐藏控件
- [ ] 4.2 将 Effort 受控状态接入画布与聊天编排；主线空闲时可改，生成中或非主线分支与模型选择一起禁用
- [ ] 4.3 扩展 Thread Chat request body 编译，使每次生成携带所属 Thread 的 Effort，并补充纯函数测试
- [ ] 4.4 扩展聊天 API 请求边界：先严格验证 modelId，再对缺省 Effort 应用模型默认值、对显式非法值返回 400，并仅向 UMAPIS 调用传入已验证的 provider options
- [ ] 4.5 验证 UMAPIS 的标准 reasoning/usage 流直接透传；仅当 1.1 证明返回字面标签时才配置抽取中间件，并回归工具调用与 Markdown Artifact 终止条件

## 5. 未计费预览隔离与验收

- [ ] 5.1 明确标记 UMAPIS 模型为未计费预览，确保其不展示虚构单价、不扣用户付费额度，同时允许保留 token usage；不得在本 change 增加 UMAPIS 价格或成本对账实现
- [ ] 5.2 运行格式化、lint、typecheck、build、OpenSpec strict validation 及相关自动化测试，修复所有本变更引入的问题
- [ ] 5.3 使用四个模型逐一完成真实流式 smoke；每个模型至少验证默认 Effort，Claude/GPT 各至少验证一个非默认 Effort，并确认缺 Key、非法 Effort 和现有 provider 回归场景
- [ ] 5.4 在验收记录中单独列出后续 billing spec 的输入：UMAPIS 官方价格、Effort 是否影响价格、汇率/利润、额度策略、并发敞口与真实成本对账；本 change 到此结束，不实现这些事项
