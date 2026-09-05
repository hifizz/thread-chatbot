## Context

当前模型注册表同时承担产品展示、入口校验、上游模型映射、provider 分派和部分计费策略；Thread Chat 客户端还直接消费完整注册对象。现有 AI SDK v7 provider 已经负责具体模型调用，业务运行时的实际边界是 `LanguageModel`，而不是 endpoint、API Key 或自建 provider 类。详见 proposal.md 与 `specs/llm-provider-routing/spec.md`。

当前项目没有统一的模型能力消费链路，且不同渠道的协议、usage 元数据和鉴权方式并不一致。因此本变更只治理模型身份与调用路由，不把上游 `/models` 目录当作产品配置。

## Goals / Non-Goals

**Goals:**

- 将聊天 LLM 相关代码聚合到 `lib/ai/llm/`，目录结构保持扁平、可读。
- 使用稳定的产品模型 ID 作为唯一业务入口。
- 用服务端私有路由表把产品模型 ID 映射为 AI SDK `LanguageModel`。
- 支持 OpenRouter、Vercel AI Gateway、Cloudflare AI Gateway 和私有 OpenAI-compatible Relay。
- 让客户端只获取公开模型 DTO，不接触内部 provider 元数据。
- 彻底移除 UMAPIS/Aiberm，并保持模型调用、计费和观测链路可审计。

**Non-Goals:**

- 不实现 ProviderManager、Provider 基类、Discovery Strategy 或 Snapshot Store。
- 不在聊天请求中调用 `/models`，不根据远程元数据自动扩展模型目录。
- 不实现负载均衡、自动 fallback、健康检查、重试、价格选择或模型路由优化。
- 不在本次变更中建立通用 vision、file、tools、reasoning capability registry。
- 不治理 embeddings、搜索服务或非聊天模型。

## Decisions

### 1. 使用 `lib/ai/llm/` 作为聊天 LLM 聚合目录

采用以下结构：

```text
constants/models/
  types.ts
  <provider>.ts
  index.ts
lib/ai/llm/
  create-models.ts
  <provider>.ts
  providers.ts
  model-routes.ts
```

`constants/models/<provider>.ts` 只声明客户端可安全消费的 provider 分组、默认值和人工审核模型；`lib/ai/llm/<provider>.ts` 只保存环境变量、协议和 SDK provider 创建逻辑。`providers.ts` 汇总服务端路由，`model-routes.ts` 保留为业务兼容入口。UMAPIS 文件删除，embeddings 和搜索继续留在原有领域目录。

不新增 `adapters/`、`strategies/` 或 `repositories/` 子目录；当前唯一共享抽象是 `createModels`，用于从 provider 模型目录生成路由并复用 provider 实例。

### 2. 将产品目录和私有路由分成两种数据

公开目录保留产品需要的字段：

```ts
PublicModel = {
  id: string
  name: string
  description?: string
  group: string
  surfaces: ChatModelSurface[]
}
```

服务端路由保留调用需要的字段：

```ts
ModelRoute = {
  createModel: () => LanguageModel
}
```

公开模型目录与私有路由表通过同一个稳定 `id` 关联。客户端只消费目录派生的 DTO；Base URL、API Key、网关账号、协议实例和计费来源全部留在服务端模块。

备选方案是继续分别维护 `constants/model.ts` 与 `constants/client-model.ts`；该方案会让模型 ID、名称、分组和入口持续漂移，因此不采用。这两个文件只保留兼容导出。

### 3. provider 模型文件作为人工审核 allowlist

每个 provider 在 `constants/models/<provider>.ts` 声明一份共享模型目录：

```ts
const openrouterModels = defineProviderModels({
  id: "openrouter",
  name: "巴厘岛",
  defaults: { surfaces: ["thread"] },
  models: [{ id: "openai/model-a", name: "Model A" }],
  toPublicModelId: (id) => `openrouter-${id.slice(id.lastIndexOf("/") + 1)}`,
})
```

客户端从这些目录生成展示 DTO，服务端把同一目录交给 `createModels` 生成路由。provider 级别的密钥、地址和网关账号从环境变量读取；模型列表不通过远程 `/models` 自动生成。

这样新增模型需要一次代码审查，能够同步确认产品入口、价格、reasoning 传输和工具兼容性。若未来需要自动发现，只增加独立的 CI/运维差异检查，不改变线上 allowlist。

### 4. provider 作为服务端实现细节，而不是产品身份

`resolveChatModel(modelId)` 只接受产品模型 ID，并从私有路由表找到 `createModel()`。`createModels` 延迟调用一次 `createProvider()`，同一 provider 的所有模型复用该实例；每次选模只调用复用实例的模型创建函数。创建函数直接返回 AI SDK `LanguageModel`，业务层继续调用 `streamText({ model, ... })`。

- OpenRouter 使用专用 SDK，并保留 usage accounting 所需设置。
- Vercel Gateway 使用 AI SDK 的 Gateway provider。
- Cloudflare Gateway 使用 OpenAI-compatible provider 指向 compat 端点。
- 私有 Relay 使用 OpenAI-compatible provider，并从服务端环境变量读取 API 根地址和密钥。

每个产品模型只绑定一条明确渠道。删除当前“Vercel → Cloudflare → 直连”的隐式全局回退，避免生成路径、计费路径和故障行为不一致。需要备用渠道时，未来将其登记为另一条明确模型路由，而不是在运行时偷偷切换。

### 5. 环境变量只承载部署配置

每类渠道使用自己的服务端环境变量保存密钥、地址和账号信息；模型的公开 ID 不由客户端提交 provider 配置来决定。`createModel()` 在被调用时读取并校验必要环境变量，缺失时抛出不包含秘密值的配置错误。

不把 `endpoint + apiKey` 返回为 `ResolvedModel`，因为这会扩大凭据和路由信息的传播范围；AI SDK `LanguageModel` 是业务层唯一输出。

### 6. 保留窄策略字段，删除未消费能力抽象

共享目录允许声明前端确实需要的窄能力字段，例如 reasoning、附件或视觉支持；provider 默认能力由工厂合并，单个模型只写差异。没有业务消费者的能力不提前登记，也不从 provider metadata 自动推断。

### 7. 旧渠道按无兼容方式删除

删除 UMAPIS/Aiberm 的产品模型、默认值、provider 创建代码、环境变量说明、CI 注入、文档和相关测试。由于当前没有需要兼容的用户或历史模型数据，旧模型 ID 不做别名迁移；收到旧 ID 时直接按未知模型拒绝。

## Risks / Trade-offs

- **[Risk]** 私有路由配置错误会使某个模型不可用。→ 在服务端解析前校验必要环境变量，并增加每条路由的配置检查与 smoke test。
- **[Risk]** 客户端仍可能通过错误导入拿到私有目录。→ 将公开 DTO 与私有路由模块分离，检查客户端依赖图，并禁止客户端导入 `lib/ai/llm/*`。
- **[Risk]** 上游模型改名或下线不会自动被发现。→ 接受 MVP 的人工 allowlist 取舍；后续用独立检查脚本报告差异，不让远程目录直接改变产品行为。
- **[Risk]** 不同渠道对 tools、reasoning、图片和 usage 的支持不同。→ 当前保持既有调用策略，不自动宣称能力；新增能力时以实际业务消费者和渠道 smoke test 为准。
- **[Risk]** 删除 UMAPIS/Aiberm 后旧线程中的模型 ID 无法继续生成。→ 当前无兼容用户，直接拒绝并在部署前清理默认值、测试数据和文档引用。
- **[Risk]** AI SDK patch 版本升级可能改变 provider 类型。→ 继续使用项目已安装的 AI SDK v7 API，并在实现后运行类型检查、构建和相关端到端检查。

## Migration Plan

1. 建立公开模型目录与 `lib/ai/llm/model-routes.ts` 的私有路由表，先接入目标的 OpenRouter、Vercel Gateway、Cloudflare Gateway 和 Relay。
2. 将聊天调用入口切换到新的解析函数，保持 `/api/chat` 和 Thread Chat 的上层 `streamText` 调用不变。
3. 将模型选择器改为只消费公开 DTO，并确认 API 请求不接受 provider、endpoint 或上游模型覆盖字段。
4. 将仍在使用的聊天 provider 创建函数迁移到 `lib/ai/llm/`；删除 UMAPIS/Aiberm 实现与所有配置引用。
5. 更新模型默认值、入口集合、价格和观测/测试契约，确认删除后的模型不会再被计费或路由逻辑引用。
6. 运行类型检查、lint、构建和现有相关端到端检查；对代码、环境变量示例、CI、文档执行全局旧名称搜索。
7. 部署新版本并执行配置完整性与各路由 smoke test。

由于本次明确不做兼容，回滚方式是回滚整个应用版本并恢复对应版本的服务端环境变量；不单独保留旧模型别名或双路由。

## Open Questions

无。目录、公开身份、私有路由、allowlist 与旧渠道移除范围均已确定。
