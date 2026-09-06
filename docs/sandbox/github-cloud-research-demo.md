# GitHub 云调研 Demo

基于 `main@7da00eaba9fb116a4ff4612b08005f51e886cd45`。目标是在现有 ThreadChat 对话中验证：输入请求 → 云沙箱准备 → 读取代码 → 模型调研 → Markdown 报告 → GitHub 草稿 PR。

## 运行

沿用现有应用的数据库、登录和模型配置。在 `.env.local` 增加：

```dotenv
CLOUD_RESEARCH_DEMO_ENABLED=true
CLOUD_RESEARCH_DEMO_USER_ID=你的应用用户ID
CLOUD_RESEARCH_DEMO_REPOSITORIES=hifizz/coding
CLOUD_RESEARCH_GITHUB_TOKEN=限定仓库的GitHubToken
E2B_API_KEY=你的E2BKey
```

`USER_ID` 是 better-auth 的 `user.id`，不是邮箱或 GitHub 用户名。允许仓库列表以逗号分隔。PAT 仅授权目标仓库，读取需要 Contents Read；提交还需要 Contents Write 和 Pull requests Write。私有仓库同样通过该 Token 读取。默认关闭，未配置时普通聊天流程不变。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

登录上述账号，打开一个 Project 的 Thread，选择现有可用且支持工具调用的模型，发送：

```text
@GitHub 帮我看下 github/hifizz/coding 的代码，调研如何开发 agent 云任务功能。
给我一份包含代码依据、最小实现方案和验收步骤的报告。
/publish-pr
```

也支持 `@ GitHub` 和完整 `https://github.com/hifizz/coding` 地址。这里的 `@GitHub` 是普通文本入口，尚未实现 GitHub 连接器胶囊、OAuth 或仓库选择器。单独一行 `/publish-pr` 明确授权本次报告提交；省略时只生成报告。一次请求限定一个仓库。

## 可观察结果

### 无数据库的真实联调入口

配置上面的变量，再设置 `CLOUD_RESEARCH_MODEL_ID` 为项目中已有、且对应 Provider Key 已配置的模型 ID。可以先不启动数据库，用同一份任务逻辑验证外部服务：

```bash
corepack pnpm cloud-research:smoke --check "@GitHub github/hifizz/thread-chatbot 调研 agent 云任务"
corepack pnpm cloud-research:smoke --publish "@GitHub github/hifizz/thread-chatbot 调研 agent 云任务，给出源码依据和实现建议"
```

第一条仅检查配置，不消费额度；第二条调用真实模型、E2B 和 GitHub，并打印阶段、报告正文和真实 PR 链接。它不模拟外部服务，但不覆盖应用登录、数据库保存和浏览器展示；完整验收仍需在 ThreadChat 页面执行。Ctrl+C 会请求停止和回收。

### 开发页面的 UI 验收入口

启动 `pnpm dev` 后访问 `http://localhost:4040/thread-chat-gate-3-harness/00000000-0000-4000-8000-000000000098`，右侧测试场景选择“云调研 UI（模拟服务）”，再发送一条消息。阶段约 3.6 秒收敛，可检查任务卡、超长读取内容和 Artifact 抽屉。此入口只在开发模式且 localhost 可访问，沿用项目原有 harness 权限边界；所有阶段明确标为演示数据，PR 链接指向本功能实现 PR #98。

### 正常任务的结果

1. 消息内实时出现配置校验、版本确认、沙箱启动和代码加载状态。
2. 每次检索/读取分别显示进行中、完成或失败，展开可查看返回内容及截断提示。
3. 模型的行动说明和报告参数逐步到达前端，报告复用 Markdown Artifact 的生成进度、阅读与保存逻辑。
4. 发布阶段显示真实 GitHub 返回的 PR 链接。提交只新增 `docs/research/<assistantMessageId>.md`，从本次读取的提交创建独立分支，PR 为草稿，不合并。
5. 发布失败时保留已生成的报告。若分支或文件已写入而后续失败，状态提示分支名，人工检查后处理；demo 不自动重复写入。

流式状态使用 AI SDK 7 的 preliminary tool results，复用现有 `TextStreamPart → UIMessageChunk → Message.parts` 管线及 SSE。阶段来自实际执行回调；读取命令的输出在该命令结束时返回，尚未逐字节转发终端 stdout。展示的是行动说明、工具事件和可用的模型输出，不承诺暴露完整内部推理。

## 实现与边界

- `generation-plan.ts` 在网页研究路由之前识别显式入口，普通聊天保持原有路径。
- `lib/cloud-research/generation.ts` 使用现有模型 Provider + AI SDK 工具循环；模型在 ThreadChat 服务端调度，沙箱承载代码文件与只读检索。这版没有在沙箱里启动 Codex/Claude Code CLI。
- `@computesdk/e2b` 使用 ComputeSDK Direct Provider Mode，没有新增自有 SandboxProvider、厂商路由或适配层。可核对[官方 Direct Mode 示例](https://github.com/computesdk/computesdk/tree/main/packages/e2b)。
- 服务端通过 GitHub API 固定默认分支的 SHA，下载源码快照并送入 E2B；这样支持私有仓库且 Token 不进入沙箱。该过程不建立完整 `.git` 历史，也不需要安装项目依赖。
- 固定 Python 程序负责解压、列目录、字面搜索和按行读取；不执行仓库脚本，拒绝越界路径、跳过符号链接与常见密钥文件。20 MB 压缩包、100 MB 解压体积、10,000 条目、512 KB 单文件、每次最多 200 行/24,000 字符、20 次读取调用和 10 分钟任务上限。仓库中未按惯例命名的敏感内容仍可能进入报告，提交前应 review 草稿 PR。
- 账号与仓库由服务端配置严格限定；这是单账号演示，不是多租户 GitHub 授权系统。模型上下文只包含本次请求和仓库内容，不加入项目 Memory、Instructions 或其他对话历史。
- 复用现有消息生命周期与报告持久化，不改数据库 schema，不增加 migration。
- 浏览器断开后由现有服务端消费者继续执行；进程重启不恢复任务，多实例和无服务器超时限制仍然存在。请在单个持续运行的 Node 服务上验证。Stop/超时/结束会请求回收沙箱，E2B TTL 兜底；已经被 GitHub 接收的写入不能靠 Stop 撤回。
- 尚未实现持久队列、自动重试/断点执行、独立任务列表、Token 自动续期及云沙箱费用计费。上线为正式长任务功能时优先补任务记录、独立 worker 和事件重放，再扩展通用 coding agent。

## 验证记录

```bash
corepack pnpm typecheck
node --import tsx e2e/thread-chat/cloud-research.test.mjs
node --import tsx e2e/thread-chat/cloud-research-reader.test.mjs
node --import tsx e2e/thread-chat/cloud-research-client.test.mjs
node --import tsx e2e/thread-chat/normalized-ui-message-pipeline.test.mjs
```

云调研测试使用真实 AI SDK 多轮调用、preliminary 事件和项目消息流 reducer，模拟外部模型、E2B 和 GitHub；覆盖报告提取、发布失败保留报告、停止与延迟创建后的回收、账号/仓库限制及 PR REST 参数。读取器测试在本机 Python 运行同一份固定脚本。

开发环境没有 E2B、模型、数据库凭据，因此尚未做真实云端端到端、实际数据库保存或真实报告 PR 验收。代码通过不等于服务已联通；配置完成后以以上示例实际跑一遍，验收私有仓库读取、报告引用、真实 PR、刷新与 Stop。

2026-09-06 补充检查：GitHub 连接器已成功创建本功能草稿 PR #98；`hifizz/coding` 返回 404，不能确认是仓库不存在还是当前连接无权限。未找到 E2B/Daytona/ComputeSDK/Coolify 插件，本地也没有 Coolify CLI 或项目 `.env.local`。Cloud Browser 访问 localhost 返回 `ERR_BLOCKED_BY_CLIENT`，浏览器视觉验收未完成。新增客户端测试覆盖实际 SSE 解析、Store 阶段更新和 React 任务卡渲染，但使用模拟服务，不能代替真实云端与浏览器验收。
