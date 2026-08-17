## Why

Thread Chat 的 OpenRouter 模型目录缺少近期已上架的 Qwen3.8 Max、Grok 4.5 与 Grok 4.6，用户无法在既有专属 OpenRouter 路由中选择它们。

## What Changes

- 在固定 OpenRouter 产品目录中增加 Qwen3.8 Max（`qwen/qwen3.8-max`）、Grok 4.5（`x-ai/grok-4.5`）与 Grok 4.6（`x-ai/grok-4.6`），各自使用唯一的内部 `openrouter-*` id。
- 将三项模型纳入 Thread Chat 选择器、持久化校验与既有 OpenRouter 专属 provider，不改变其他 provider 的路由。
- 以 OpenRouter 公开目录核对静态回退成本；Grok 两项采用其 200K 以上的最高已知阶梯价，防止缺失真实成本元数据时低估成本。
- 扩展模型注册、可见性、定价和文档验证。GLM 5.3 目前未在 OpenRouter 目录中提供，明确不在本 change 范围内。

## Capabilities

### New Capabilities

- `openrouter-latest-model-access`: 规定三项近期 OpenRouter 模型的固定注册、Thread Chat 可用性、专属路由与保守回退计费。

### Modified Capabilities

（无——现有 OpenRouter capability 仍保留在已完成 change 的变更目录中，本 change 新建独立增量契约。）

## Impact

- `constants/model.ts`、`constants/pricing.ts` 与 Thread Chat 模型选择器增加模型注册、展示分组和回退价。
- `e2e/thread-chat/openrouter-models.test.mjs` 扩展为覆盖 13 项 OpenRouter 模型。
- `README.md`、`README.zh-CN.md` 更新固定内部模型目录说明；不新增依赖、环境变量或 API 请求字段。
