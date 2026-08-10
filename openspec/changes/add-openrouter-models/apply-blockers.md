# Apply 阻塞记录

## 2026-08-10

### 阻塞任务

- 任务 1.1：安装与 AI SDK v7 兼容的 OpenRouter AI SDK provider 直接依赖。
- 任务 7.2：使用真实 OpenRouter key 完成流式与工具调用 smoke。

### 已验证事实

- 当前项目与 pnpm store 均没有 OpenRouter AI SDK provider。
- 执行依赖安装时，npm registry 请求由当前环境网络代理返回 HTTP 403，依赖未写入 package.json 或 lockfile。
- 当前进程、.env 与 .env.local 均没有可用的 OPENROUTER_API_KEY。

### 继续条件

1. 允许访问 npm registry，或预置与 ai@^7 兼容的 OpenRouter provider 包及其完整依赖。
2. 在服务端环境提供 OPENROUTER_API_KEY，以便执行真实 smoke（不得提交密钥）。

在依赖可用前，不使用通用 OpenAI-compatible provider 替代专属 provider，因为这会违反本 change 对原生 reasoning 与逐 step 成本元数据的明确契约。任务复选框保持未完成。
