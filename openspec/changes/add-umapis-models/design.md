## Context

项目已有统一模型注册表、provider 解析层和 Thread 级 modelId 持久化。UMAPIS 是同时暴露 Claude 与 GPT 的新上游渠道，不应伪装成现有 OpenAI 直连或落入 Vercel/Cloudflare/Ark 的路由链。

当前实际可用的 Prompt 输入属于 Thread Chat，模型选项由 `THREAD_CHAT_MODELS` 派生。已用用户提供的两组有效凭据验证四个模型在 OpenAI-compatible `/v1/chat/completions` 端点的默认流式调用；本次只接入这个已验证的默认调用，不猜测或发送 Effort 参数。

## Goals / Non-Goals

**Goals:**

- 通过 UMAPIS 调用指定四个模型，不改变现有 provider 路由。
- 让四个模型出现在 Thread Chat Prompt 输入关联的模型选择器，且不改变既有默认模型、历史 id 或分支锁定规则。
- 让每个模型按 Claude/GPT 组使用正确的服务端 Key，并兼容 Base URL 写成站点根路径或 `/v1` 路径。
- 默认调用不携带 Effort / `reasoning_effort`，保留上游已有的流式、reasoning、工具和 usage 行为。
- 保留流式文本、reasoning、工具和 usage 行为。

**Non-Goals:**

- UMAPIS 价格、成本、售价、扣费、对账及按 Effort 的价格差异。
- 改造现有 MiniMax、Ark、Vercel、Cloudflare 或供应商直连路由。
- 允许非主线分支单独切换模型。
- 重写现有通用 ModelSelector。
- 本次提供 UMAPIS Effort 配置；该协议与 UI 另行在后续 change 确认和实现。

## Decisions

### D1：UMAPIS 是独立路由 provider

模型 provider 类型增加 `umapis`，四个注册项保留上游 id，并显式声明 `claude` 或 `gpt` 凭据组。新增 adapter 集中读取 `UMAPIS_API_KEY_CLAUDE`、`UMAPIS_API_KEY_GPT` 与可选 `UMAPIS_BASE_URL`；统一 provider 解析层为其设置专属短路分支，不进入其他网关或直连优先链。

这能准确区分“模型创建者”与“调用渠道”，也让可用性只取决于 UMAPIS 凭据。弃选把 Claude 冒充 openai provider 或复用现有网关链，因为两者都会造成错误的配置语义。

### D2：默认调用不传 Effort

UMAPIS 模型注册项不包含 Effort 元数据，Prompt 输入的选择器不显示该控件，服务端也不向 `streamText` 传入 UMAPIS 专用 provider options。这避免在参数名、支持集和计费影响尚未确认时猜测上游协议。

### D3：未计费预览隔离

本 change 不写入价格、不解析成本元数据、不改变对账结构。新模型暂为明确的未计费预览：可以记录 token usage，但不扣用户付费额度，也不展示虚构单价。后续独立 billing spec 再定义价格、利润、限额和正式放量。

## Risks / Trade-offs

- **[UMAPIS 协议当前不可访问]** → apply 以协议验证为硬门槛；无官方证据或有效 smoke 请求时不得猜值。
- **[OpenAI-compatible 不代表默认流形态完全一致]** → adapter 使用已验证的 `/v1` 路径与 Bearer 鉴权，并用四个模型做真实流式 smoke。
- **[Claude 与 GPT 使用不同权限组]** → 每个注册项显式绑定凭据组；可用性判断和 provider 创建均只读取该组 Key。
- **[预览会产生上游成本而不扣用户额度]** → 限制预览开放面；价格、配额与正式放量由下一份 billing spec 处理。

## Migration Plan

1. 记录已验证的默认协议，再实现注册与 provider。
2. 部署代码和两组 UMAPIS 配置；缺少某组 Key 时，仅该组模型请求返回可读 400。
3. 回滚时移除选项与 provider；既有 Thread 的历史 model id 回退行为不变，无需数据迁移。

## Open Questions

- 四个模型各自接受的 Effort 参数名、取值、默认值与计费影响是什么？

这不是本次默认调用的阻塞项；后续 Effort change 必须通过官方资料或真实请求关闭该问题，且不扩展本 change 的计费范围。
