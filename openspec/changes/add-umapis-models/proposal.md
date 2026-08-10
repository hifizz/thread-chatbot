## Why

当前 Thread Chat 的模型注册表和请求链路尚不能通过 UMAPIS 使用最新的 Claude 与 GPT 5.6 模型，而现有的 Effort 选择器能力也还没有进入 Thread 状态、持久化和服务端请求。本次先完成“模型可用 + 每个模型的 Effort 可配置”这一个可独立验收的范围，不把计费扩展混入同一次变更。

## What Changes

- 新增 UMAPIS 专属的 OpenAI-compatible provider 路由与服务端配置，通过单独的 API Key/Base URL 调用 UMAPIS，不复用现有 Vercel Gateway、Cloudflare Gateway、Ark 或供应商直连分支。
- 在统一模型注册表中增加 `claude-opus-4-6`、`claude-sonnet-5`、`gpt-5.6-sol` 和 `gpt-5.6-terra`，并将它们纳入 Thread Chat 的可选模型集合。
- 为模型注册项声明各自允许的 Effort 集合和默认值；界面只展示当前模型支持的选项，切换模型时对无效 Effort 做确定性回退。
- 把 Effort 作为 Thread 级状态进行选择、分支继承和持久化，并随每次聊天请求发送；服务端依据模型注册表严格校验后再转换为 UMAPIS 的上游参数。
- 兼容历史分支树中不存在 Effort 的数据；非 UMAPIS 模型不发送 UMAPIS Effort 参数，现有模型路由和分支模型锁定规则保持不变。
- 补充注册表、Effort 解析、请求编译与历史数据兼容的自动化检查，并记录可选的真实流式 smoke 验证步骤。
- **明确不在本次范围**：UMAPIS 价格、成本估算、售价、余额扣减与对账；这些留给后续独立 OpenSpec change。在该 change 落地前，新模型明确作为“暂未计费的预览模型”，不消耗付费额度，也不对用户展示虚构价格。

## Capabilities

### New Capabilities

- `umapis-model-access`: 定义四个 UMAPIS 模型的注册、专属 provider 路由、Thread Chat 可见性、配置错误和流式对话行为。
- `model-effort-selection`: 定义按模型限定的 Effort 选择、回退、Thread 级持久化/继承、请求校验与上游参数映射。

### Modified Capabilities

（无——`openspec/specs/` 中尚无已发布的模型路由或 Effort capability；本次不为尚未归档的 change 创建伪 delta。）

## Impact

- **模型领域**：`constants/model.ts` 的 provider/effort 元数据、四个模型注册项、`THREAD_CHAT_MODELS` 及选择器消费方。
- **模型解析**：新增 UMAPIS provider 封装，`lib/ai/provider.ts` 增加配置检查和专属短路分支，`app/api/chat/route.ts` 增加 Effort 请求边界校验和 provider options。
- **Thread 领域与 UI**：`app/thread-chat/core/*`、`app/thread-chat/net/*`、Thread 模型选择器及编排组件需要承载 Effort；现有 compound selector 的 Effort API 将被复用。
- **配置与文档**：`.env.example` 和项目 README 增加 `UMAPIS_API_KEY` 及可选 `UMAPIS_BASE_URL`；实施前需用 UMAPIS 官方文档/真实请求确认 Effort 的精确参数名与各模型取值。
- **计费隔离**：本 change 不修改 `constants/pricing.ts`、用量流水或余额逻辑；新模型的计费启用由后续 spec 统一定义。
