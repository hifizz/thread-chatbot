## 1. 建立模型身份与目录契约

- [x] 1.1 将产品模型目录收敛为客户端可安全消费的公开字段，并为当前入口选择稳定的公开模型 ID
- [x] 1.2 将真实 provider、上游模型 ID、网关模型 ID、凭据组和计费策略从公开模型对象中移出
- [x] 1.3 为每个目标 provider 建立服务端人工审核的 `modelsList`，校验公开 ID 唯一且覆盖所有允许入口

## 2. 建立服务端 LLM 路由

- [x] 2.1 创建 `lib/ai/llm/`，迁移仍使用的聊天 LLM 创建函数并保持扁平结构
- [x] 2.2 实现 `ModelRoute` 与单一模型解析入口，使合法公开 ID 返回 AI SDK `LanguageModel`
- [x] 2.3 实现 OpenRouter 路由，保留必要的 usage accounting 与成本元数据处理
- [x] 2.4 实现 Vercel AI Gateway 路由和 Cloudflare AI Gateway compat 路由
- [x] 2.5 实现私有 OpenAI-compatible Relay 路由，确保地址、密钥和真实上游模型只在服务端读取
- [x] 2.6 将缺少路由配置的错误收敛为不泄露秘密值的服务端配置错误

## 3. 迁移聊天业务调用

- [x] 3.1 将线性聊天与 Thread Chat 的模型校验和解析切换到新的公开目录与解析入口
- [x] 3.2 保持上层 `streamText` 调用只接收 `LanguageModel`，删除业务层对 endpoint、API Key 和 provider 分派细节的依赖
- [x] 3.3 删除隐式的 Vercel → Cloudflare → 直连全局回退，改为每个模型绑定明确服务端路由
- [x] 3.4 更新默认模型、入口集合、价格关联、reasoning 传输策略和观测字段，确保均引用新模型 ID

## 4. 隔离客户端与 API 边界

- [x] 4.1 修改 Thread Chat 模型选择器，只消费公开模型 DTO，不导入 `lib/ai/llm/*`
- [x] 4.2 确认客户端请求只提交公开模型 ID，服务端忽略或拒绝 provider、endpoint 和上游模型覆盖字段
- [x] 4.3 检查模型列表、错误响应和日志回传，确认不包含真实 provider、上游模型、网关地址、凭据组或密钥

## 5. 移除旧中转渠道

- [x] 5.1 删除 UMAPIS/Aiberm 模型注册、默认模型、provider 实现和所有路由分支
- [x] 5.2 从 `.env.example`、本地配置说明、CI workflow 和部署配置中删除 UMAPIS/Aiberm 变量
- [x] 5.3 删除或更新依赖旧模型 ID 的价格、观测、评测、端到端测试和产品文档
- [x] 5.4 清理旧 provider 名称与地址的全局引用，并确认旧模型请求不会触发任何上游调用

## 6. 验证与发布检查

- [x] 6.1 为模型 allowlist、未知模型、缺失配置和旧模型 ID 增加可执行验证
- [x] 6.2 使用已授权且已配置的塞班岛 Relay 执行真实 smoke test，确认模型选择、请求路由、流式响应与终态
- [x] 6.3 运行 `pnpm typecheck`、`pnpm lint`、相关 Thread Chat 检查和 `pnpm build`
- [x] 6.4 执行运行代码、配置和活动文档中的旧 provider 名称、地址和环境变量搜索，并保留历史 OpenSpec 审计记录
- [x] 6.5 检查客户端依赖图，确认服务端路由模块不会进入浏览器 bundle

## 7. 恢复冰岛中性 Relay

- [x] 7.1 使用中性模型 ID 恢复冰岛模型 allowlist，不引入旧品牌名称
- [x] 7.2 使用单一 API Key 实现冰岛 Anthropic/OpenAI 两种协议路由与配置检查
- [x] 7.3 使用 `ICELAND_RELAY_BASE_URL` 和 `ICELAND_RELAY_API_KEY` 更新客户端模型分组和环境变量文档
- [x] 7.4 运行源码残留扫描、类型检查、lint、路由测试和构建
