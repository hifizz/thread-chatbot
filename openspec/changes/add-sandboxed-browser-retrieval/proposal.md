## Why

搜索 API 与托管正文提取无法稳定覆盖必须执行 JavaScript、展开交互内容或等待客户端渲染的页面，但把 Playwright 直接放进主应用进程会扩大网络、凭据和资源攻击面。浏览器能力应是数据证明需要后再启用的独立高风险层，而不是 Web Search MVP 的前置条件。

## What Changes

- 仅在前三批数据证明「搜索 + 受控提取」对目标编程问题仍有明确覆盖缺口时，引入隔离的托管浏览器执行环境。
- 通过 Vercel Marketplace 的实时 `web-automation` discovery 选择并开通浏览器服务；当前调研基线优先评估 Browserbase，若选择自管 Playwright 则必须运行在 Vercel Sandbox 等临时隔离环境中，而不是 `/api/chat` 主函数进程。
- 模型只获得高层 `browseSource` 能力，不获得任意 shell、文件系统或通用网络工具；入口仍必须来自已验证来源账本。
- 每次浏览器任务使用临时会话、无用户 cookies/本地存储/应用密钥、严格出站策略、资源/时间/导航/下载上限，并在结束后销毁。
- 禁止登录、支付、表单提交、文件上传、下载执行和改变外部状态；页面内容继续按不可信数据处理。
- 对浏览器调用单独计费、限额、审计和告警；默认 Auto Search 不调用浏览器，只有显式能力策略或高置信受支持场景才可升级。
- 建立恶意重定向、私网目标、下载、无限页面、提示注入、跨域导航与资源耗尽安全测试。

## Capabilities

### New Capabilities

- `sandboxed-browser-retrieval`：来源受限的隔离浏览器读取、生命周期、网络/凭据/资源安全、计费与审计。

### Modified Capabilities

（无——该能力是可选的独立升级层，不修改当前 canonical specs。）

## Impact

- **依赖**：必须后于 `add-proactive-web-search`、`add-controlled-web-fetch` 和 `harden-web-retrieval-operations`；启动条件是可量化的覆盖缺口而非主观完整性诉求。
- **外部服务**：托管浏览器或 Vercel Sandbox 资源、Marketplace 安装、独立凭据和预算。
- **服务端**：新增异步浏览器任务 adapter、来源校验、出站策略、超时/取消和结果净化；主对话仅消费净化后的文本/截图元数据。
- **安全/合规**：新增浏览器威胁模型、审计日志、数据保留与应急禁用开关。
- **产品**：默认搜索路径不变；UI 明确区分“搜索”“读取网页”“浏览器访问”。
