# 接入 OpenRouter 最新模型

## Why

现有模型网关与 Thread 级模型选择已经完成，但尚不能通过 OpenRouter 使用 GPT-5.6、GPT-5.5、Kimi K3 与 DeepSeek V4 Flash 0731。OpenRouter 同时存在 reasoning、长上下文阶梯价和逐请求真实成本元数据，若只把这些模型塞进现有供应商直连分支，会造成模型来源语义混乱并使当前扁平价格估算在长上下文下低估成本。

## What Changes

- 引入与项目 `ai@^7` 匹配的 `@openrouter/ai-sdk-provider`，以 `OPENROUTER_API_KEY` 通过 OpenRouter 专属路由调用模型，不经过既有 Vercel AI Gateway、Cloudflare AI Gateway、Ark Coding Plan 或供应商直连分支。
- 在统一模型注册表中增加 10 个 OpenRouter 模型：GPT-5.6 Luna/Luna Pro/Terra/Terra Pro/Sol/Sol Pro、GPT-5.5/GPT-5.5 Pro、Kimi K3、DeepSeek V4 Flash 0731，并显式区分模型创建者与调用路由。
- 将新增模型纳入 Thread Chat 可选模型集合、持久化校验和请求严格校验；既有树与现有模型 id 保持兼容。
- 以 OpenRouter 返回的逐请求真实美元成本作为成功生成的优先计费依据，记录独立成本来源并按既有汇率和利润率计算售价；静态价格仅作为元数据缺失时的保守回退。
- 保留 OpenRouter 标准 reasoning 流与 token usage，不对其应用仅适用于字面 `<think>` 的抽取中间件；本变更不新增 reasoning-effort 选择或持久化能力。
- 增加环境变量、文档、注册表/计费一致性测试及真实流式 smoke 验证说明。

## Capabilities

### New Capabilities

- `openrouter-model-access`：定义 OpenRouter 模型注册、专属 provider 路由、Thread Chat 选择、配置错误、reasoning/usage 透传、真实成本计费及兼容回退行为。

### Modified Capabilities

（无——`openspec/specs/` 中没有现行的模型网关或 Thread 模型选择 capability；已完成但尚未归档的 change 文档作为设计背景，不在本变更中创建伪 delta。）

## Impact

- **依赖**：`package.json`/`pnpm-lock.yaml` 增加 `@openrouter/ai-sdk-provider` 的 AI SDK v7 兼容版本。
- **模型领域**：`constants/model.ts` 的 `ChatModel` 路由字段、模型注册项、`THREAD_CHAT_MODELS` 与排序/展示消费方。
- **模型解析**：新增 `lib/ai/openrouter.ts`；`lib/ai/provider.ts` 增加 OpenRouter 配置判断与专属短路分支。
- **聊天接口**：`app/api/chat/route.ts` 继续接受既有 `modelId?: unknown`，但在 `onFinish` 中额外解析 OpenRouter usage/cost metadata。
- **计费**：`constants/pricing.ts` 增加 10 个非零保守回退价；`lib/billing/credits.ts` 支持传入真实美元成本；`lib/db/billing-schema.ts` 的 `costSource` 类型增加 `openrouter`。该字段底层仍是 PostgreSQL `text`，无需数据库 DDL 迁移。
- **配置与文档**：`.env.example`、README/README.zh-CN.md 增加 `OPENROUTER_API_KEY` 及可选应用归因配置说明。
- **不受影响**：MiniMax 直连、Ark Coding Plan、既有 Vercel/CF/供应商路由优先级、Thread 分支模型锁定规则、数据库中的历史 `modelId` 与历史用量流水。
