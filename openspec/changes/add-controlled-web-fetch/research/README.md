# Research：受控 Web Fetch、引用与信息源 Tag

- 调研日期：2026-08-02 至 2026-08-03
- 前置：`add-proactive-web-search`
- 性质：非规范性证据记录；安全与引用契约以本 change specs 为准

## 1. 业界资料与结论

### 1.1 Search→选择来源→Fetch→综合是成熟分层

[Claude Web Fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) 展示了组合流程：先用 Search 找到相关页面，选择最合适结果，再 Fetch 全文并带引用回答。其文档同时说明 Web Fetch 不支持 JavaScript 动态渲染页面。

**结论**：全文读取应只在搜索片段不足时触发；JavaScript 页面不应迫使普通 Fetch 变成浏览器，浏览器另分 change。

### 1.2 模型不能自由构造 Fetch URL

Claude 官方为降低数据外泄风险，限制 Fetch 只能访问用户明确给出的 URL，或此前 Search/Fetch 结果中的 URL；不能访问模型动态构造的任意 URL。文档仍明确指出存在 residual risk，并建议 `max_uses` 和 domain restriction。

[OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) 强调：完整 URL 难以安全验证；重定向可能绕过输入校验；DNS 解析存在将合法域绑定到内网 IP 的风险；应用层和网络层需要纵深防御。

**结论**：工具输入不能是 `readUrl({url})`。本项目采用请求内 source ledger + `readSource({sourceId})`，先从目的地能力上限制，再做 URL 校验。任何未来 direct fetch 必须复验 DNS/redirect 并限制 egress。

### 1.3 页面正文是不可信数据

Claude 文档直接警告：在 untrusted input 与 sensitive data 共存的环境启用 Fetch 会有 exfiltration 风险。页面可能通过 prompt injection 指示模型泄密、访问别的地址或调用工具。

**结论**：正文只作为 evidence，用结构化字段和 untrusted delimiter 包裹；页面内容没有 system/user/tool authority；Fetch 工具本身不能接受新 URL 或动作。

### 1.4 引用必须贴近内容且可验证

- Gemini grounded response 使用 inline annotations，将回答片段映射到来源。
- Claude Web Search citation 包含 URL、title、cited text。
- [ALCE](https://arxiv.org/abs/2305.14627) 分开评估 fluency、correctness、citation quality，并指出最佳系统也经常缺少完整引用支持。

**结论**：本项目不能只在末尾列“参考资料”。模型输出 sourceId marker，UI 在被支撑的实体/事实句/段落后显示 `[1]` tag；引用要分别评估 validity、placement、correctness、completeness。

## 2. 当前项目证据

| 文件 | 当前行为 | 风险/缺口 |
|---|---|---|
| `lib/chat/research-tools.ts` | `readUrl` schema 直接接受字符串 URL | 模型/注入内容可以提出任意目的地 |
| `lib/ai/search.ts` | `extractUrl(url)` 把 URL 发给 Tavily `/extract` | 没有 source ledger、显式 timeout/size/type 策略 |
| `constants/research.ts` | `EXTRACT_CHAR_LIMIT=8000` | 只限注入字符，没有来源生命周期和调用预算 |
| `app/thread-chat/net/ui-stream.ts` | 其他 tool event 静默丢弃 | 无法构建 message-owned sources |
| Branch tree message JSON | 可扩展 JSON 结构 | 可增加 compact sources，但不能保存网页全文 |

当前调用由 Tavily 托管提取，应用不直接连接目标 URL，因此比直接 server fetch 少一层应用网络 SSRF 风险；但仍必须限制模型目的地、验证输入、隔离正文，并为未来 adapter 保留更严格要求。

## 3. 信息源 Tag 设计推导

### 3.1 为什么不用普通 Markdown 链接作为唯一契约

- 普通链接携带 URL 而不是 sourceId，模型可能写出未检索 URL。
- 链接文本可能与来源支撑关系不清，无法确定它支撑哪个事实句。
- reload 后需要从 URL 反查 provider 结果，canonicalization 容易失配。

### 3.2 选择的持久化形式

模型输出 server-owned marker，例如：

```text
Next.js 16.2 改变了该缓存行为。[[cite:src_a1b2]]
```

消息同时持久化 compact source ledger。Renderer 将合法 marker 解析为 `[1]` tag：

- 默认放在最小可支撑事实句/主张后。
- 只有精确版本、日期、数值、身份才适合实体级 tag。
- 只有同一来源集合支撑整段主要事实时才适合段末 tag。
- 多来源可相邻或分组，但每个 tag 映射唯一 sourceId。
- 普通名词不重复贴 tag，避免引用噪声。

合法 tag hover/focus 展示 title/domain/snippet；click/keyboard activation 用 `target="_blank" rel="noopener noreferrer"` 打开 ledger canonical URL。未知 ID 显示不可点击“来源不可验证”，不猜 URL。

## 4. 成本研究

[Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits) 说明 Basic Extract 每 5 个成功 URL 抽取消耗 1 credit，失败不收费。虽然 provider 可以批量 5 URL，本工具为保持 source-to-claim 清晰每次只提交 1 URL；底层仍应按 provider 实际 usage 而非“每次必定 1 credit”盲算，若 API 只按批次结算则需在账务层保守估值并定期核对。

**修正先前口语化估算**：单个 Basic Extract 的边际账单取决于 provider 的“每 5 个成功 URL”计量，而不是官方明确的每 URL 1 credit。Spec 仍要求每次 attempt 可审计，实施时应读取 provider usage/账单确定实际 units。

## 5. 决策追踪

| Research 结论 | ADR | Spec |
|---|---|---|
| 模型不能自由构造目的地 | [ADR-0001](../adrs/0001-source-id-not-raw-url.md) | `controlled-web-fetch` |
| 先托管 Extract，不在主进程跑浏览器 | [ADR-0002](../adrs/0002-managed-extract-before-browser.md) | `controlled-web-fetch` |
| 来源账本与 inline tag 是一体 | [ADR-0003](../adrs/0003-source-ledger-inline-tags.md) | `grounded-web-citations` |
| 引用质量要拆维度评估 | [ADR-0004](../adrs/0004-citation-quality-dimensions.md) | `grounded-web-citations` |

## 6. 资料清单

- [Claude Web Fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)
- [Claude Web Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [Gemini Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search?hl=en)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [ALCE](https://arxiv.org/abs/2305.14627)
- [Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits)

