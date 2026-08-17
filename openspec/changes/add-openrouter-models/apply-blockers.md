# Apply 阻塞记录

## 2026-08-11

### 阻塞任务

- 任务 7.2：使用真实 OpenRouter key 对 GPT-5.6 Luna、Kimi K3、DeepSeek V4 Flash 0731 运行流式文本与工具调用 smoke，并记录 GPT-5.5 Pro 的高成本手工验证项。

### 初次验证事实

- `.env.local` 中存在 `OPENROUTER_API_KEY` 配置，但其值不符合 OpenRouter API key 的标准格式。
- 使用该值调用 OpenRouter 原生 `/api/v1/chat/completions` 与项目的 `@openrouter/ai-sdk-provider` 均返回 HTTP 401，错误为 `Missing Authentication header`。
- 因认证未通过，三个目标模型均未产生可验证的流式文本、工具调用、usage 或真实成本结果；GPT-5.5 Pro 也未执行高成本手工验证。
- 本次未修改源码，任务 7.2 复选框保持未完成。

### 继续条件

在服务端环境提供有效的 OpenRouter API key（通常以 `sk-or-v1-` 开头）后，重新运行三个模型的文本/工具 smoke，并单独记录 GPT-5.5 Pro 为高成本手工验证项。

## 2026-08-11 key 更新后复核

### 验证结果

- 新 key 符合 OpenRouter 格式，`GET /api/v1/key` 返回 HTTP 200。
- GPT-5.6 Luna、Kimi K3、DeepSeek V4 Flash 0731 均完成纯文本流：收到 text delta、`finishReason=stop`，无流内错误。
- 三个模型均完成工具流：产生工具调用与工具结果，均有 2 steps、无流内错误，并成功解析 OpenRouter 逐 step cost。
- GPT-5.5 Pro 未执行自动请求，已按任务要求保留为高成本手工验证项。
- 任务 7.2 已完成；本文件保留初次认证失败记录，便于追溯。
