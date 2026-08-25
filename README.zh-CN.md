# Thread Chat

**Thread Chat 是一个分支式对话工作区：你可以沿着某个想法继续探索，同时保留它原本所处的对话上下文。** 在回复中选择文本，从该上下文创建分支，并在多列或画布中比较、导航这些对话。

> [English documentation](./README.md)

- 在线产品：<https://thread-chat.zilin.im/>
- 源代码仓库：<https://github.com/hifizz/thread-chatbot>

## 功能

- **从回复中的任意位置开启新分支（带上下文）。** 选中一个短语、论点、例子或问题，就能开启一段继承分叉点之前全部上下文的专注对话。分支可以独立发展，不会打乱或改变原来的主线；遇到新的想法时，还可以继续向下分叉。
- **把整段对话作为一棵树来浏览。** 在可调整宽度的多列中并排查看重要对话，通过面包屑和搜索在分支之间移动，或缩放到画布纵览所有对话之间的关系，并随时回到任意分支。

## 快速开始

### 前置条件

- Node.js `>=20.9.0` 和 [pnpm](https://pnpm.io/)（本仓库声明 `pnpm@10.32.1`）
- PostgreSQL 数据库
- 至少一个受支持模型提供商的凭据；默认模型使用 MiniMax

克隆仓库并安装依赖：

```bash
git clone https://github.com/hifizz/thread-chatbot.git
cd thread-chatbot
pnpm install
cp .env.example .env.local
```

默认的最小本地配置需在 `.env.local` 中填写以下值：

```dotenv
DATABASE_URL=postgres://...
DIRECT_URL=postgres://...
BETTER_AUTH_SECRET=replace-with-a-high-entropy-secret
BETTER_AUTH_URL=http://localhost:4040
MINIMAX_API_KEY=...
```

运行中的应用需要 `DATABASE_URL`。`pnpm db:migrate` 优先使用 `DIRECT_URL`，未设置时回退到 `DATABASE_URL`；如果运行时 URL 是事务连接池地址，请为迁移使用数据库直连 URL。`.env.example` 已为 `MINIMAX_BASE_URL` 和 `LLM_MODEL_ID` 提供默认值，因此默认配置无需填写它们。也可以使用其他已配置的模型提供商替代 MiniMax，但默认模型选择需要 `MINIMAX_API_KEY`。

执行迁移并启动开发服务器：

```bash
pnpm db:migrate
pnpm dev
```

打开 <http://localhost:4040/thread-chat> 进入 Thread Chat 工作区。按提示登录；裸路径会在可用时恢复最近打开的树，而 `/thread-chat/{treeId}` 这样的树 URL 则标识一段特定的已持久化对话。

### 可选集成

以下能力均为按需配置，快速开始不需要它们：

- Web 搜索与网页读取：AnySearch 可匿名使用；配置 `ANYSEARCH_API_KEY` 可获得更高配额与限流
- 附件与 PDF 处理：Cloudflare R2 变量（`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`）
- 大文档向量检索：`EMBEDDINGS_BASE_URL`、`EMBEDDINGS_API_KEY`、`EMBEDDINGS_MODEL`，以及 PostgreSQL `pgvector`
- 其他模型提供商和网关：`.env.example` 中说明的提供商 key、Cloudflare AI Gateway 或 Vercel AI Gateway 变量
- 邮箱验证、Turnstile、Google 登录、计费和 Creem 支付：`.env.example` 中各功能对应的变量

请勿提交 `.env.local` 或任何凭据。

## OpenRouter 模型

Thread Chat 提供 13 个固定走 OpenRouter 的内部模型 id：`openrouter-gpt-5.6-luna`、`openrouter-gpt-5.6-luna-pro`、`openrouter-gpt-5.6-terra`、`openrouter-gpt-5.6-terra-pro`、`openrouter-gpt-5.6-sol`、`openrouter-gpt-5.6-sol-pro`、`openrouter-gpt-5.5`、`openrouter-gpt-5.5-pro`、`openrouter-kimi-k3`、`openrouter-deepseek-v4-flash-0731`、`openrouter-qwen3.8-max`、`openrouter-grok-4.5` 和 `openrouter-grok-4.6`。必须配置 `OPENROUTER_API_KEY`；`OPENROUTER_HTTP_REFERER` 与 `OPENROUTER_APP_TITLE` 是可选归因信息。这些 id 固定使用专属 OpenRouter provider，API 会拒绝任意外部 slug。OpenRouter 当前未列出 GLM 5.3，因此不提供该模型。成功请求在每个 step 的成本元数据完整时按真实美元成本计费，否则使用保守静态价回退。附件仍沿用现有文本提取路径。

## UMAPIS 预览模型

Thread Chat Prompt 输入关联的模型选择器提供 `constants/model.ts` 中注册的 UMAPIS Claude 与 GPT 预览模型。Claude 模型配置 `UMAPIS_API_KEY_CLAUDE`，GPT 模型配置 `UMAPIS_API_KEY_GPT`；`UMAPIS_BASE_URL` 可选，可填写站点根路径或 `/v1` API 根路径。请求保持上游默认行为，不发送 Effort 参数。这些模型是未计费预览：不要求用户余额为正、不扣额度、不展示未经验证的价格。Effort 配置与 UMAPIS 计费由后续 spec 单独定义。

## 架构

项目基于 Next.js 16 App Router，使用 React、TypeScript、Tailwind CSS、Base UI 支撑的 shadcn 组件、assistant-ui、AI SDK、Drizzle ORM 和 PostgreSQL。

| 边界   | 位置                                                                 | 职责                                                     |
| ------ | -------------------------------------------------------------------- | -------------------------------------------------------- |
| 核心   | [`app/thread-chat/core/`](./app/thread-chat/core/)                   | 对话树状态、选择器和分支对话 store                       |
| 分支   | [`app/thread-chat/branching/`](./app/thread-chat/branching/)         | `selection/` 管文本锚点与划选交互，`assistant/` 管分支感知渲染 |
| 对话   | [`app/thread-chat/chat/`](./app/thread-chat/chat/)                   | 用 `message/`、`composer/`、`actions/` 聚合三个对话功能集 |
| 编排   | [`app/thread-chat/orchestration/`](./app/thread-chat/orchestration/) | 用 `canvas/`、`columns/`、`navigation/`、`artifacts/`、`overlays/`、`workspace/` 组合工作台 |
| 网络   | [`app/thread-chat/net/`](./app/thread-chat/net/)                     | 用 `boot/`、`commands/`、`persistence/`、`prompt/`、`stream/`、`titles/` 隔离客户端 I/O |
| 服务端 | [`app/api/`](./app/api/) 和 [`lib/chat/`](./lib/chat/)               | 认证、模型流式输出、工具处理、分支树 API、附件和研究工具 |

仓库内提供了更详细的设计材料：

- [ChatPDF 调研](./docs/chatpdf/01-调研报告.md)和[设计](./docs/chatpdf/02-设计方案.md)
- [深度研究设计](./docs/deep-research/设计说明.md)
- [OpenSpec 变更记录](./openspec/changes/)
- [项目开发指引](./CLAUDE.md)

## 状态与路线图

Thread Chat 正在积极开发中。当前仓库已包含已认证的聊天、持久化分支树、多列和画布工作区、Markdown 交付物、可选附件、深度研究、账户流程及计费集成。在稳定版本发布前，界面和运行集成仍可能继续演进。

当前方向包括加强自动化覆盖、完善部署和配置指引，以及持续优化不同屏幕尺寸下的分支工作区体验。请以 issue 跟踪器和已接受的 OpenSpec 变更作为计划工作的事实来源。

### 路线图

> 按主题分类，优先级标记：**P0** = 最高优先。

#### P0 · 高优先级

- [ ] **继承上下文压缩** - 压缩分支继承的上下文，降低多列对话成本。
- [ ] **Project 工作区** - 支持项目级目标设定与共享文档。
- [ ] **产品内记忆** - 面向 project 研究的长期记忆能力。

#### 核心功能

- [ ] **内容总结与索引** - 总结一列或一主题的讨论，并支持索引与沉淀。
- [ ] **多租户与多用户** - 用户隔离，记忆按用户/项目维度组织。
- [ ] **联网搜索** - 为对话接入联网搜索能力。
- [ ] **DeepResearch** - 增加深研究功能。
- [ ] **Skill 系统** - 网页端 Skill 与内置 Skill Creator。
- [ ] **Sub-agent** - 多 Sub-agent 的创建、监听与结果汇总。

#### Interactive Preview

- [ ] **Interactive Preview** - 在生成内容中渲染可交互的可视化产物。

#### Markdown 与内容渲染

- [ ] **Markdown 渲染增强** - 完善渲染与必备功能，含 Mermaid。
- [ ] **代码块高亮** - 优化代码块高亮体验。
- [ ] **Markdown 产物展示** - 优化面板位置与信息密度。
- [ ] **HTML 生成与预览** - 支持 HTML 生成与预览。

#### UI / UX 交互

- [ ] **选中文本工具栏** - 划选文本后的快捷功能气泡。
- [ ] **对话目录** - 每个对话的侧边目录导航。
- [ ] **滚动到底部按钮** - 优化位置与出现阈值。
- [ ] **输入框区域简化** - 简化底部输入样式。
- [ ] **整体 UI 微优化** - 微调 UI 元素与交互效果。

## 贡献

欢迎提交 issue 和 pull request。请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，其中说明了 pnpm 工作流、验证命令和贡献条款。

## 许可证

Copyright © 2026 hifizz。

Thread Chat 使用 [GNU Affero General Public License v3.0 only（AGPL-3.0-only）](./LICENSE)。本项目许可证不会替代或覆盖第三方依赖、资源或单独署名代码所适用的许可证和声明。
