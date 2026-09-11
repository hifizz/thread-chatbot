# Issue #126 联网恢复验收记录

日期：2026-09-11。代码基线：main `63b0efc`。

## 实现范围

- 两个聊天入口复用模式工具列表；fetch 首步 readUrl，之后允许 webSearch/readUrl。
- 工具统一返回 `ok/data` 或安全的失败结果；失败不作为正文、来源或读取成功。
- AnySearch 检查 HTTP、JSON-RPC、MCP isError，支持结构化正文与多个文本块，拒绝明确错误页。
- readUrl 在同 URL 内按 AnySearch → 已配置的 Exa 尝试，每家一次；未知程序异常、无效 URL、安全拒绝及用户取消不触发备用。
- 每次生成独立共享预算：最多 6 次上游调用、45 秒（首个上游请求起计）、最多 3 个并发。备用计数，在途请求受 deadline 中断；计时器与取消监听随请求清理。
- 同一失败请求缓存、在途请求合并；URL 保留查询参数，查询仅去首尾空白。预算耗尽后仍允许模型解释及生成 Artifact。
- 去掉把“什么是/解释”直接锁定 answer 的规则，语义路由根据实体、时效性及上下文证据判断；明确禁止联网优先于深度研究开关。
- 共用提示词约束替代来源、原文限定、部分正文、无法核实与无依据否定。

参数仍是试行值，真实模型评测完成前不宣称是最优生产配置。

## 已通过

```sh
pnpm typecheck
node --import tsx --test e2e/thread-chat/web-recovery.test.mjs e2e/thread-chat/tool-step-policy.test.mjs e2e/thread-chat/research-router-context.test.mjs e2e/thread-chat/research-context.test.mjs e2e/thread-chat/search-abort.test.mjs e2e/thread-chat/normalized-ui-message-pipeline.test.mjs e2e/thread-chat/prompt-cache-contract.test.mjs e2e/observability/provider-attempt.test.mjs
```

18 项测试通过，含失败分类、备用切换、预算硬计数、deadline、排队取消、去重、跨轮隔离、来源/活动契约、首步策略与 Artifact 回归。修改文件 ESLint 检查通过。

ego-browser 任务空间 3、localhost:4044：用本次创建的测试消息临时加载固定活动数据，验证失败、成功、部分正文、无联网活动四种实际 UI 状态，随后恢复消息。失败显示“未能核实”且不出现“已读取网页”；部分正文有明确标记；无联网活动不显示提示。**这些是 UI 固定样本测试，不是真实模型端到端通过的替代证据。**

## 原 URL 的真实供应商证据

2026-09-11T12:28:14.241Z，匿名 AnySearch Extract 请求目标：
`https://openai.com/index/introducing-the-agents-api/`。

HTTP 200，无 isError，但 `result.structuredContent.content` 为 `# This page couldnâ€™t load` 和重试提示，文本块则包含转义 JSON。该次请求取得的是错误页，不能认定读取成功。此证据不能说明网站/供应商所有请求都会失败，也未证明截图中的请求与本次原因完全一致。

真实样本已加入固定回归。原始响应和浏览器截图保存在 `/tmp/issue126-evidence/`：`openai-anysearch-raw.json`、`ui-failure.png`、`ui-partial.png`、`ui-success.png`、`ui-stable.png`、`model-config-blocked.png`、`tests.tap`。

Exa 接口依据官方 Contents 文档：https://exa.ai/docs/reference/get-contents 。备用需要 `EXA_API_KEY`；未配置时跳过。

## 尚未通过：真实模型验收被环境阻塞

当前工作区及共享 `.env.local` 缺少 `TOKEN_ROUTER_BASE_URL`、`TOKEN_ROUTER_API_KEY`。浏览器提交“什么是 OpenAI 的 agents-api？”后生成初始化失败，未进入联网工具。未取得有效回答、实际模型工具轨迹、模型费用或延迟样本，因此以下项目仍待验收：

- 无“最新”或 URL 的产品解释主动核实，来源日期与引用支持度。
- JavaScript 闭包稳定概念的真实模型不必要搜索率、成本及延迟。
- 固定读取失败 → 搜索 → 读取替代来源 → 有依据且标注替代的回答。
- 用户仅依据原文的约束；全部来源失败/空结果时明确无法核实而非否定产品存在。
- 真实模型取消、整轮预算和最终说明。

配置模型入口后继续同一 ego-browser 任务空间。`e2e/thread-chat/web-recovery-preload.mjs` 是仅供本地的供应商故障注入器，用 NODE_OPTIONS 显式加载；产品不读取这个开关。控制文件提供 `mode: live/recover/empty` 和本地 `log` 路径。recover 只使原目标抽取失败，其余调用真实服务；empty 返回固定空搜索与工具错误。所有原始响应仅保存到本地验收目录，不输出认证请求头。

## 2026-09-12：按反馈精简失败展示

面板不再显示“联网核实遇到失败”、失败域名条目或重复失败说明。仅展示仍在进行的操作和有效来源；全部失败时隐藏面板，任务是否受影响由最终回答说明。内部失败状态和来源过滤仍保留。上文失败界面的截图为调整前记录，不代表当前展示。

本次调整使用类型检查及静态检查验证，未重新启动已按要求关闭的测试服务器。
