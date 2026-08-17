## Context

`add-openrouter-models` 已完成 OpenRouter 专属 provider、真实逐 step 成本优先计费以及 10 项固定模型。新模型只需复用这条成熟链路；不得改走 Vercel AI Gateway、Cloudflare AI Gateway 或创建者的直连 provider。

OpenRouter 在 2026-08-16 的公开目录中列出 Qwen3.8 Max、Grok 4.5 和 Grok 4.6。三项均支持工具调用与原生 reasoning。该目录中没有 GLM 5.3，因此不登记不可用 slug，也不以已有 Ark GLM 5.2 替代。

## Goals / Non-Goals

**Goals:**

- 将三项已验证模型作为固定、可持久化的 Thread Chat 选项加入既有 OpenRouter 注册表。
- 保持 OpenRouter 真实成本优先；成本元数据缺失时提供非零、保守的静态回退价格。
- 将品牌排序、说明文档和纯回归测试与注册表同步。

**Non-Goals:**

- 不新增 GLM 5.3、动态目录同步、任意 slug 输入、provider 路由参数或 reasoning-effort UI。
- 不开放模型原生的图片、文件或视频输入；继续使用现有附件文本化路径。
- 不发送有成本的生产 smoke 请求；本 change 使用公开目录核对与本地回归验证。

## Decisions

### D1：使用目录中的精确 OpenRouter slug

注册项分别使用 `qwen/qwen3.8-max`、`x-ai/grok-4.5` 与 `x-ai/grok-4.6`。内部 id 延续 `openrouter-*` 前缀，provider 固定为 `openrouter`，reasoning transport 固定为 `native`。

不登记用户最初提到但当前目录不可用的 GLM 5.3：猜测或预注册 slug 会让选择器暴露必然失败的模型。

### D2：回退价覆盖 OpenRouter 已知最高阶梯

Qwen3.8 Max 的公开输入/输出价为 $2/$6 每百万 token；Grok 4.5/4.6 在输入超过 200K token 时升至 $4/$12。静态回退价采用这些最高已知档位，真实逐 step `usage.cost` 完整存在时仍优先使用真实成本。

### D3：展示分组使用 slug 创建者前缀

模型选择器按 `qwen` 与 `x-ai` 前缀将新条目放入既有品牌分组顺序，而不维护独立 id 列表。`ChatModel.creator` 扩展为仅展示用途的 `qwen` 与 `x-ai` 标识。

## Risks / Trade-offs

- [OpenRouter 目录或定价未来变化] → 固定目录保证产品可控；每次增补前重新核对公开目录，成功请求优先按真实成本计费。
- [高上下文 Grok 在元数据缺失时被低估] → 静态回退价使用 200K 以上最高公开阶梯。
- [模型的多模态宣传与当前输入管道不匹配] → 保持现有附件文本化路径，不传 provider-specific multimodal parts。
