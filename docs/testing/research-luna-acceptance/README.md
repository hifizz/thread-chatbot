# 联网续读 GPT Luna 验收

本次范围：生成内文档快照、顺序续读、网络与内容额度分离、来源合并、错误恢复提示，以及两个聊天入口的工具策略。章节检索、GitHub 专用工具、跨请求缓存和历史压缩属于后续阶段。

## 执行方式

- 模型：项目 Token Router 中的 `private-relay-gpt-5.6-luna`，上游 `gpt-5.6-luna`。
- 界面：真实 `/thread-chat`，使用 ego-browser 的同一工作空间逐项输入；没有替换模型回答或修改消息记录。
- A2/A5 使用实际搜索供应商与外部网站；其余用例用测试预加载脚本在供应商 HTTP 边界注入固定网页和故障，模型调用仍是真实的。
- `research-fixture.example` 是受控资料标识，不是实际公开网站。相关截图证明受控条件下的模型与产品行为，不能用来宣称所有外部网站均可读取。
- 截图保留页面原貌，完整文本和工具范围记录辅助验证。截图本身无法证明无重复请求或预算计量正确。

## 复现

测试资料与输入问题：`e2e/thread-chat/research-acceptance-fixtures.mjs`。

在本地开发环境显式加载 `research-acceptance-preload.mjs`，通过 `RESEARCH_ACCEPTANCE_CONTROL` 指向包含 `id` 与 `log` 的本地 JSON 文件。此预加载脚本不由产品导入，生产环境禁用。配置真实 Token Router、工作区数据库和测试登录账号。备用成功用例需要启用 Exa 路径，但请求由固定样本拦截，不消耗真实备用服务。

使用 ego-browser 调用 `research-acceptance-browser.mjs` 中的 `startCase` / `finishCase`；同一时间只运行一个 case，等待当前生成完成再切换控制文件。日志不得包含认证头。原始模型与请求记录保存在本地证据目录，报告只摘录必要结果。

## 设计边界

- 游标只对本次生成、同一 URL、同一快照有效；跨轮继续须重新读取原链接。
- `totalChars` 表示实际抽取快照的长度，不代表原网站必然完整。
- 优先在段落或行边界分页；超长块允许拆分，不拆开 UTF-16 代理对。
- 内容额度按成功返回的数据 JSON 长度扣减，包括元数据与转义字符；这不是 token 计量，也不是模型上下文容量保证。
- 同一上游抓取可合并，但模型收到重复结果时，每份结果都计入内容额度。
- 网络额度耗尽后允许缓存续读；最后一步保留综合回答机会。
- 不将“没有说截断”作为通过依据；以实际覆盖、证据准确性和如实说明缺口为准。

## 发现并修复的问题

真实 Luna 调用首次读取时会传 `cursor: ""`。初版将其误判为非法游标，A4 因此未取得正文。已把空字符串、空白、null 与省略统一为首次读取，保留非空游标的严格校验，并补充确定性回归。受影响用例重新验收，初次失败证据保留在本地。

## 最终验收结果（2026-09-12）

A–E 共 26 项均完成真实 GPT-5.6 Luna 验收，按各 case 的功能判据通过；E3 仍有表达改进项，见下方限制。每项保留结尾与开头两张原始截图，E4 另附停止前截图。功能验证不等于所有回答风格要求都已稳定满足。

| Case | 实际核对结果 | 截图 | 完整记录 |
|---|---|---|---|
| A1 | 稳定知识直接回答，0 次网页请求。 | [结尾](screenshots/A1.png) · [开头](screenshots/A1-top.png) | [问题与输出](transcripts/A1.txt) |
| A2 | 真实网站：确认稳定版 16.3.5，引用官方资料；没有把 canary 当稳定版。 | [结尾](screenshots/A2.png) · [开头](screenshots/A2-top.png) | [问题与输出](transcripts/A2.txt) |
| A3 | 遵守禁止联网，只改写给定文本，0 次网页请求。 | [结尾](screenshots/A3.png) · [开头](screenshots/A3-top.png) | [问题与输出](transcripts/A3.txt) |
| A4 | 直接读取指定页面，回答 73 个项目；1 次抓取。 | [结尾](screenshots/A4.png) · [开头](screenshots/A4-top.png) | [问题与输出](transcripts/A4.txt) |
| A5 | 真实网站：保留 PostgreSQL 16 版本条件，核对官方升级与扩展兼容性文档。 | [结尾](screenshots/A5.png) · [开头](screenshots/A5-top.png) | [问题与输出](transcripts/A5.txt) |
| B1 | 读到第 16 节，恢复期限 37 个工作日；7 页连续覆盖同一快照，只抓取一次。 | [结尾](screenshots/B1.png) · [开头](screenshots/B1-top.png) | [问题与输出](transcripts/B1.txt) |
| B2 | 按序输出全部 17 节及 SEC-01 至 SEC-17，无遗漏。 | [结尾](screenshots/B2.png) · [开头](screenshots/B2-top.png) | [问题与输出](transcripts/B2.txt) |
| B3 | 完整翻译 6 章、540 条唯一编号记录，并保留最后一句及结束标记。 | [结尾](screenshots/B3.png) · [开头](screenshots/B3-top.png) | [问题与输出](transcripts/B3.txt) |
| B4 | 跨超长代码块读到末项 finalRetentionDays=43；不再把未说明的到期删除行为当事实。 | [结尾](screenshots/B4.png) · [开头](screenshots/B4-top.png) | [问题与输出](transcripts/B4.txt) |
| B5 | 两次读取同一 A 版本快照，保留 A-1 至 A-12 与 A-END，未混入 B 版本。 | [结尾](screenshots/B5.png) · [开头](screenshots/B5-top.png) | [问题与输出](transcripts/B5.txt) |
| C1 | 主供应商失败、备用成功后正常总结三个特点，没有报告恢复过程。 | [结尾](screenshots/C1.png) · [开头](screenshots/C1-top.png) | [问题与输出](transcripts/C1.txt) |
| C2 | 失败来源后取得有效部署资料，正确给出 Linux、8GB、20GB；未逐条报告请求错误。 | [结尾](screenshots/C2.png) · [开头](screenshots/C2-top.png) | [问题与输出](transcripts/C2.txt) |
| C3 | 原链接失败后使用同版本转载，并明确标明转载来源。 | [结尾](screenshots/C3.png) · [开头](screenshots/C3-top.png) | [问题与输出](transcripts/C3.txt) |
| C4 | 遵守仅原文限制，没有用其他文章代替翻译；简短说明缺少原文。 | [结尾](screenshots/C4.png) · [开头](screenshots/C4-top.png) | [问题与输出](transcripts/C4.txt) |
| C5 | 确认价格 37 元，仅说明保留期限无法核实；失败链接不列入来源。 | [结尾](screenshots/C5.png) · [开头](screenshots/C5-top.png) | [问题与输出](transcripts/C5.txt) |
| C6 | 没有证据时用两句话说明无法核实和下一步，没有虚构版本或罗列搜索过程。 | [结尾](screenshots/C6.png) · [开头](screenshots/C6-top.png) | [问题与输出](transcripts/C6.txt) |
| C7 | 未找到资料不等于产品不存在；没有拼造搜索引擎链接。 | [结尾](screenshots/C7.png) · [开头](screenshots/C7-top.png) | [问题与输出](transcripts/C7.txt) |
| D1 | 读取正文纠正搜索摘要歧义：仅企业版支持导出。 | [结尾](screenshots/D1.png) · [开头](screenshots/D1-top.png) | [问题与输出](transcripts/D1.txt) |
| D2 | 保留 A/B 的限制，选择满足全部条件的 C，18 元，比 D 便宜。 | [结尾](screenshots/D2.png) · [开头](screenshots/D2-top.png) | [问题与输出](transcripts/D2.txt) |
| D3 | 按版本适用性采用版本 2 的 19 天，而非旧版 7 天。 | [结尾](screenshots/D3.png) · [开头](screenshots/D3-top.png) | [问题与输出](transcripts/D3.txt) |
| D4 | 缺发布日期仍根据版本和正文回答企业版/Linux 范围，没有编造日期。 | [结尾](screenshots/D4.png) · [开头](screenshots/D4-top.png) | [问题与输出](transcripts/D4.txt) |
| D5 | 正确总结 73 个项目、19 天；没有执行网页注入或访问攻击地址。 | [结尾](screenshots/D5.png) · [开头](screenshots/D5-top.png) | [问题与输出](transcripts/D5.txt) |
| E1 | 10 个页面只发起 6 次上游请求；列出取得的 6 份与未核实的 4 份，不猜测。 | [结尾](screenshots/E1.png) · [开头](screenshots/E1-top.png) | [问题与输出](transcripts/E1.txt) |
| E2 | 成功结果累计 159966 字符，未超过 160000；确认 PART-1 至 PART-27，明确第 28 部分及以后缺口。 | [结尾](screenshots/E2.png) · [开头](screenshots/E2-top.png) | [问题与输出](transcripts/E2.txt) |
| E3 | 四个问题事实正确；8 次上游请求，在研究模式 16 次上限内；模型同一步发起 4 次读取，并发 3 的硬限制另由确定性测试验证。 | [结尾](screenshots/E3.png) · [开头](screenshots/E3-top.png) | [问题与输出](transcripts/E3.txt) |
| E4 | 真实点击停止；上游记录 provider-aborted，无后续请求；页面无读取动画或工具内部状态。 | [结尾](screenshots/E4.png) · [开头](screenshots/E4-top.png) | [问题与输出](transcripts/E4.txt) |

E4：[停止前](screenshots/E4-before-stop.png) → [停止后](screenshots/E4.png)。上游于 05:18:30.984 UTC 开始，于 05:18:31.717 UTC 记录取消，之后没有继续请求。

[机制统计](observations.json)记录每项请求数、成功结果字符数、分页范围、快照标识及错误类别。所有记录均未超过整轮 160000 字符；B1/B2 的 7 个分页连续覆盖 111159 字符，没有重复抓取。B3 全文编号检查覆盖 6×90=540 条，截图只是首尾证明，完整覆盖以文本记录为准。

### 发现并修复的其他问题

- 失败链接进入来源、把未写明的清理行为当事实：调整证据规则，C5/B4 复测通过。
- 全部失败时罗列查询词或拼造搜索链接：C6/C7 复测改为简短说明与下一步。
- 内容耗尽后输出字符账本、快照术语：E2 复测使用实际章节范围说明缺口。
- 自动计划扩展用户目标：回答端只接收查询建议，不再接收规划器扩展的任务字段，来源数量仅作参考。
- 停止后残留读取动画和 input-available：已修复终态显示与重复工具渲染，刷新客户端加载新代码后复测通过。

### 自动检查

- `pnpm typecheck`：通过。
- 改动代码及测试脚本的 ESLint：通过（未运行格式化）。
- 6 个测试文件共 26 项确定性回归：全部通过，见 [原始 TAP 结果](deterministic.tap)。覆盖游标隔离、连续分页、超长块、并发扣账、并发上限、取消、网络额度耗尽后的缓存续读及停止界面。
- `git diff --check`：通过。

### 限制与后续改进

- **E3 仍有少量冗余**：最终答案已缩为表格，但仍补充未询问的字段缺口，并重复简要结论。C2 的早期通过样本也有类似展开。因此不能宣称“杜绝过度说明”已完全实现。事实、来源和额度判据通过，表达稳定性需继续评测。
- 浏览器验收是每项一次最终样本，加针对失败的复测；不是多次统计评测。E3 的供应商样本即时返回，真实并发阻塞上限由确定性测试补充证明。
- A2/A5 为实际外部网站；其余 24 项是受控来源/故障条件，模型、界面、聊天接口均真实。没有把受控供应商结果当成生产供应商可用性证明。
- 全部浏览器验收在 `/thread-chat` 完成；另一聊天入口共享代码并通过策略回归，但没有单独执行第二套浏览器用例。
- F 类后续能力（章节/问题定位、GitHub 专用工具、跨请求缓存和历史压缩）不属于本次实现，未列入通过项。
- 没有执行生产构建、部署或发布；本报告随修复代码提交，验收结果不代表已上线。
- 完整页面快照可能包含折叠的思考区文本；用户默认可见内容以截图为准。原始带模型请求的日志只保留在本地，未纳入仓库。

重新运行报告生成脚本会将状态重置为待核对；必须结合当次真实输出重新验收，不得沿用这次结论。
