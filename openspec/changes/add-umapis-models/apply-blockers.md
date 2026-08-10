# Apply 阻塞记录

## 2026-08-10

### 阻塞任务

- 任务 1.1：确认 UMAPIS Base URL、聊天路径、鉴权、模型 id、逐模型 Effort 矩阵、reasoning 与 usage 协议。
- 任务 1.2、5.3：用真实凭据完成 Claude/GPT 最小请求与四模型 smoke。

### 已验证事实

- 访问 UMAPIS pricing 页面时，当前环境网络代理返回 HTTP 401/403，无法取得可作为实现依据的官方协议内容。
- 当前进程、.env 与 .env.local 均没有可用的 UMAPIS_API_KEY。
- proposal/design 明确规定：无法验证协议时必须停止，不能根据 OpenAI 或 Anthropic 的通用经验猜测 Effort 参数。

### 继续条件

以下任一方式可解除协议阻塞：

1. 提供可读取的 UMAPIS 官方 API 文档（不仅是定价页），其中包含上述协议字段；或
2. 在服务端环境提供 UMAPIS_API_KEY 与官方 Base URL，以便执行脱敏最小请求（不得提交密钥）。

在条件满足前，不实现 UMAPIS adapter、Effort 枚举或上游 provider options，以免固化未经验证的协议。任务复选框保持未完成。
