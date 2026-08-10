# Research：隔离浏览器 Retrieval

- 调研日期：2026-08-03
- 前置：Search + managed Extract 的真实覆盖缺口已经量化
- 性质：可选能力的安全研究；当前结论是“不进入 MVP”

## 1. 为什么浏览器不是默认 Web Fetch

[Claude Web Fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) 官方说明其 Fetch 当前不支持 JavaScript 动态渲染页面。这证明 JS 页面确实是独立能力缺口，但也说明成熟产品会把普通 Fetch 与浏览器执行分开，而不是默认让每个读取请求启动 Chromium。

浏览器相对 Search/Extract 新增：

- JavaScript 执行与页面 prompt injection。
- 导航、popup、下载、表单、登录、权限请求等外部动作。
- DNS/redirect/跨域资源带来的 SSRF/egress 风险。
- cookies/storage/filesystem/environment secrets 的泄露面。
- 高启动时延、CPU/内存、session/runtime 计费和清理责任。

**结论**：只有数据显示高价值问题稳定失败于 JS 渲染，才进入 browser change；不能为了“功能完整”预先启用。

## 2. Marketplace 快照

2026-08-03 使用 Vercel CLI 58.4.0：

```bash
vercel integration discover --category web-automation --format=json
```

返回顺序：Browserbase、Kernel、Firecrawl。`agents` 类别中 Exa 第一、Browserbase 第二，并包含 Kernel、Firecrawl。

这只能说明当前 Marketplace discovery 顺序，不等于安全/成本评审。Apply 时必须升级 CLI 并重新 discovery、阅读 provider 数据保留/网络控制/会话隔离文档，再决定开通。

## 3. Vercel Sandbox 官方本地资料

已安装 Vercel plugin 提供的官方技能文件：

`/Users/zilin/.codex/plugins/cache/claude-plugins-official/vercel/0.45.1/skills/vercel-sandbox/SKILL.md`

其对应官方文档入口为 [Vercel Sandbox](https://vercel.com/docs/sandbox)。记录的关键能力：

- 使用 ephemeral Firecracker microVM 运行不可信代码/浏览器。
- 可在 microVM 内安装 agent-browser + headless Chrome。
- 每次创建隔离环境并在 `finally` stop；Vercel 部署可通过 OIDC 鉴权。
- Sandbox snapshot 可预装 Chromium 与系统依赖，避免每次约 30 秒安装，启动可降至 sub-second 级。

**推导**：如果不用 Browserbase 等托管浏览器，自管 Playwright/Chrome 应进入 Vercel Sandbox，而不是主 `/api/chat` Function。Sandbox 解决进程/文件系统隔离，但 URL/egress/action/resource policy 仍需应用自己定义。

## 4. 威胁模型

### 4.1 保护资产

- DB/auth/payment/LLM/search provider secrets。
- 用户会话、cookies、LocalStorage、附件和私密对话。
- Vercel/云 metadata endpoints 与内网服务。
- 用户余额和平台 browser budget。
- 外部网站状态（不能误提交表单、支付或上传）。

### 4.2 攻击入口

- 搜索结果/网页正文中的 prompt injection。
- 恶意 redirect、DNS rebinding、private IP/subresource。
- 页面自动 popup/download/permission/navigation。
- 无限 DOM、网络请求、CPU/memory、streaming content。
- 模型构造 URL、selector、JS 或任意 action sequence。

### 4.3 需要的边界

```text
GLM-5.2
  │ browseSource(sourceId, approvedGoal)
  ▼
Server policy / budget / source ledger
  ▼
Ephemeral hosted browser or Sandbox microVM
  │ deny-by-default egress + fixed read-only workflow
  ▼
Sanitized bounded visible text
```

模型不接触 URL、browser endpoint、shell、selector、JS 或 credentials。Session 无用户 cookies/storage、无主应用 env/filesystem；入口仍来自 source ledger。

## 5. 托管浏览器与 Vercel Sandbox 比较

| 维度 | 托管浏览器（当前候选 Browserbase） | Vercel Sandbox + 自管 Chrome |
|---|---|---|
| 浏览器运维 | provider 管理 | 项目管理 Chrome/agent-browser/snapshot |
| 隔离 | 取决于 provider session contract | ephemeral microVM，边界更可控 |
| 网络/动作策略 | 需核对 provider 能力 | 需自行实现/配置 |
| 启动 | 通常为托管 session | 无 snapshot 安装慢；snapshot 可显著改善 |
| 可移植性 | provider adapter | Vercel 平台耦合 |
| 适合 | 快速验证 browser gap | 需要自定义控制且愿意承担运维 |

当前不做最终 provider 决策；ADR 只确定“隔离环境”和“高层只读工具”是不可妥协边界。

## 6. 决策追踪

| Research 结论 | ADR | Spec |
|---|---|---|
| Browser 必须由覆盖缺口触发 | [ADR-0001](../adrs/0001-browser-gated-by-measured-need.md) | `sandboxed-browser-retrieval` |
| Browser 不在主 Chat Function | [ADR-0002](../adrs/0002-ephemeral-isolated-browser.md) | `sandboxed-browser-retrieval` |
| 模型只获得 browseSource 高层能力 | [ADR-0003](../adrs/0003-high-level-read-only-browser-tool.md) | `sandboxed-browser-retrieval` |

## 7. 资料清单

- [Claude Web Fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)
- [Vercel Sandbox](https://vercel.com/docs/sandbox)
- [Vercel Marketplace](https://vercel.com/marketplace)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- 本地官方技能：`/Users/zilin/.codex/plugins/cache/claude-plugins-official/vercel/0.45.1/skills/vercel-sandbox/SKILL.md`

