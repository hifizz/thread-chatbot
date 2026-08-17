## Why

当前 Thread Chat 的 Prompt 输入尚不能通过 UMAPIS 使用 Claude 与 GPT 5.6 模型。本次先完成“模型可用 + 默认流式调用”的可独立验收范围；UMAPIS 的 Effort 协议尚未确认，按当前产品决定不在本次接入中暴露或发送该参数，也不把计费扩展混入同一次变更。

## What Changes

- 新增 UMAPIS 专属的 OpenAI-compatible provider 路由与服务端配置。Claude 与 GPT 模型分别使用各自的 API Key，且不复用现有 Vercel Gateway、Cloudflare Gateway、Ark 或供应商直连分支。
- 在统一模型注册表中增加 `claude-opus-4-6`、`claude-sonnet-5`、`gpt-5.6-sol` 和 `gpt-5.6-terra`，并将它们纳入 Thread Chat Prompt 输入关联的模型选择器。
- 所有 UMAPIS 调用保持上游默认行为：不显示、持久化、校验或发送 Effort / `reasoning_effort` 参数。
- 保持既有 Thread 模型锁定、历史 id、现有模型路由、流式文本、工具调用、reasoning 与 usage 行为。
- 补充注册表、凭据分组、未计费预览隔离的自动化检查，并记录四个模型的真实流式 smoke 验证结果。
- **明确不在本次范围**：UMAPIS 价格、成本估算、售价、余额扣减与对账；这些留给后续独立 OpenSpec change。在该 change 落地前，新模型明确作为“暂未计费的预览模型”，不消耗付费额度，也不对用户展示虚构价格。

## Capabilities

### New Capabilities

- `umapis-model-access`: 定义四个 UMAPIS 模型的注册、专属 provider 路由、Prompt 输入可见性、配置错误和流式对话行为。
- `model-effort-selection`: 明确本次 UMAPIS 预览使用上游默认行为，不显示或发送 Effort。

### Modified Capabilities

（无——`openspec/specs/` 中尚无已发布的模型路由或 Effort capability；本次不为尚未归档的 change 创建伪 delta。）

## Impact

- **模型领域**：`constants/model.ts` 的 provider、凭据组和未计费预览元数据、四个模型注册项、`THREAD_CHAT_MODELS` 及 Prompt 输入选择器消费方。
- **模型解析**：新增 UMAPIS provider 封装，`lib/ai/provider.ts` 增加配置检查和专属短路分支，`app/api/chat/route.ts` 保持默认请求且为预览模型跳过余额拦截和扣费。
- **配置与文档**：`.env.example` 和中英文 README 增加 `UMAPIS_API_KEY_GPT`、`UMAPIS_API_KEY_CLAUDE` 及可选 `UMAPIS_BASE_URL`。
- **计费隔离**：本 change 不修改 `constants/pricing.ts` 或用量流水 schema；新模型不写入扣费流水，计费启用由后续 spec 统一定义。
