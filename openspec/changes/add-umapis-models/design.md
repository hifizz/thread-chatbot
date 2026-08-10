## Context

项目已有统一模型注册表、provider 解析层和 Thread 级 modelId 持久化。UMAPIS 是同时暴露 Claude 与 GPT 的新上游渠道，不应伪装成现有 OpenAI 直连或落入 Vercel/Cloudflare/Ark 的路由链。

通用 ModelSelector 已有按模型展示 Effort 的 UI API，但 Effort 尚未进入 Thread 状态、持久化或聊天请求。本变更横跨模型注册、provider、UI、领域状态、历史数据清洗和 API 边界，需要预先明确一致性与兼容策略。

当前执行环境访问 UMAPIS pricing 页面得到 HTTP 401/403，因此本 proposal 不猜测价格或 Effort 协议。apply 必须以届时可访问的 UMAPIS 官方 API 文档或经授权的真实请求为协议依据。

## Goals / Non-Goals

**Goals:**

- 通过 UMAPIS 调用指定四个模型，不改变现有 provider 路由。
- 用注册表表达各模型允许的 Effort 和默认值，前后端共享同一允许列表。
- Effort 跟随 Thread 持久化、分支继承和请求传输，兼容旧数据并拒绝恶意值。
- 保留流式文本、reasoning、工具和 usage 行为。

**Non-Goals:**

- UMAPIS 价格、成本、售价、扣费、对账及按 Effort 的价格差异。
- 改造现有 MiniMax、Ark、Vercel、Cloudflare 或供应商直连路由。
- 允许非主线分支单独切换模型或 Effort。
- 重写现有通用 ModelSelector。

## Decisions

### D1：UMAPIS 是独立路由 provider

模型 provider 类型增加 umapis，四个注册项保留用户给出的原始上游 id。新增集中读取 UMAPIS_API_KEY 与可选 UMAPIS_BASE_URL 的 adapter；统一 provider 解析层为其设置专属短路分支，不进入其他网关或直连优先链。

这能准确区分“模型创建者”与“调用渠道”，也让可用性只取决于 UMAPIS 凭据。弃选把 Claude 冒充 openai provider 或复用现有网关链，因为两者都会造成错误的配置语义。

### D2：Effort 由每个模型的注册项声明

支持 Effort 的模型注册项携带允许选项、默认值和上游值映射。前端从中派生选项，服务端用同一元数据校验和映射，因此 Claude 与 GPT 可以拥有不同集合，不设置全局通用枚举。

具体参数名与取值不得在 proposal 阶段猜测。apply 的第一项是核对 UMAPIS 文档或用有效凭据完成最小请求，并记录四个模型的参数名、允许值、默认值及 reasoning 响应形态；不能验证时停止实施。

### D3：Thread 保存选中 Effort，解析取决于当前模型

Thread 增加可选 effort。新 Thread 使用模型默认值，新分支复制父 Thread 的 modelId 与 effort。切换模型时，若原 Effort 仍有效则保持 sticky；否则回退到新模型默认值；不支持 Effort 的模型解析为 undefined。

历史整树 JSON 在加载时通过同一纯函数清洗 modelId 与 effort，无需数据库 DDL。弃选仅保存在 UI 本地状态，因为刷新、分支和多列会话都会丢失语义。

### D4：服务端严格重验客户端 Effort

请求体增加可选 effort。服务端先严格校验 modelId，再检查 Effort 是否属于该模型。UMAPIS 模型缺省时使用注册默认值；显式非法值返回 400。非 UMAPIS 模型不接收 UMAPIS 专用 provider 参数。

Effort 通过每次调用的 provider options 发送，不写入 system prompt；前者是可验证协议，后者只是无法保证执行的语言暗示。

### D5：复用现有 Effort UI 与分支锁定策略

Thread selector 从注册表派生 ModelOption.efforts，并在同一 popover 展示控件。主线且非生成期间允许修改；分支或生成期间与模型一起锁定。不支持 Effort 的模型不渲染空控件。

### D6：计费留给下一份 spec

本 change 不写入价格、不解析成本元数据、不改变对账结构。新模型暂为明确的未计费预览：可以记录 token usage，但不扣用户付费额度，也不展示虚构单价。后续独立 billing spec 再定义价格、利润、限额和正式放量。

## Risks / Trade-offs

- **[UMAPIS 协议当前不可访问]** → apply 以协议验证为硬门槛；无官方证据或有效 smoke 请求时不得猜值。
- **[OpenAI-compatible 不代表 provider options 完全一致]** → 上游映射集中在 UMAPIS adapter，并用真实的非默认 Effort 做 smoke。
- **[历史 JSON 可能含脏值]** → load sanitizer、store setter 与 API 边界共用解析函数并覆盖旧数据和错配值。
- **[预览会产生上游成本而不扣用户额度]** → 限制预览开放面；价格、配额与正式放量由下一份 billing spec 处理。

## Migration Plan

1. 验证 UMAPIS 协议并固化模型/Effort 矩阵，再实现注册与 provider。
2. 部署代码和 UMAPIS 配置；缺凭据时仅 UMAPIS 请求返回可读 400。
3. 旧树在读取时补默认 Effort，后续正常保存整树 JSON，无需批量迁移。
4. 回滚时移除选项与 provider；旧版会忽略 JSON 额外字段，无需反向迁移。

## Open Questions

- 四个模型各自接受的 Effort 参数名、取值和默认值是什么？
- UMAPIS 的聊天路径与 reasoning 响应形态是什么？

以上问题必须在 apply 任务 1.1 通过 UMAPIS 官方资料或真实请求关闭，但不扩展本 change 的计费范围。
