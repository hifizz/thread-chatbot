# Thread Chat

**Thread Chat 是一个分支式对话工作区：你可以沿着某个想法继续探索，同时保留它原本所处的对话上下文。** 在回复中选择文本，从该上下文创建分支，并在多列或画布中比较、导航这些对话。

> [English documentation](./README.md)

- 在线产品：<https://thread-chat.zilin.im/>
- 源代码仓库：<https://github.com/hifizz/thread-chatbot>

## 功能

- 流式返回真实模型回复；默认本地配置使用 MiniMax，模型注册表还支持已配置的其他提供商。
- 从回复中选取文本创建带上下文的分支，并为每个分支保留相关的来源上下文。
- 可在多个对话列中工作，也可在画布视图中查看和导航完整对话树。
- 将分支树持久化到 PostgreSQL，刷新后仍可重新加载；树的身份由 `/thread-chat/{treeId}` 承载。
- 直接在 Thread Chat 中生成 Markdown 交付物，并将完成的交付物保留在创建它的 assistant 消息中。
- 在配置搜索服务后提供可选的深度研究模式：多步网页搜索与页面深读，并展示有来源支撑的结果。
- 支持可选附件功能，包括 PDF 文本提取、摘要、建议问题、引用，以及面向大文档的可选向量检索。

Thread Chat 不是预设回复演示：模型请求由服务端处理，分支工作区会通过应用 API 持久化状态。

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
BETTER_AUTH_URL=http://localhost:3000
MINIMAX_API_KEY=...
```

运行中的应用需要 `DATABASE_URL`。`pnpm db:migrate` 优先使用 `DIRECT_URL`，未设置时回退到 `DATABASE_URL`；如果运行时 URL 是事务连接池地址，请为迁移使用数据库直连 URL。`.env.example` 已为 `MINIMAX_BASE_URL` 和 `LLM_MODEL_ID` 提供默认值，因此默认配置无需填写它们。也可以使用其他已配置的模型提供商替代 MiniMax，但默认模型选择需要 `MINIMAX_API_KEY`。

执行迁移并启动开发服务器：

```bash
pnpm db:migrate
pnpm dev
```

打开 <http://localhost:3000/thread-chat> 进入 Thread Chat 工作区。按提示登录；裸路径会在可用时恢复最近打开的树，而 `/thread-chat/{treeId}` 这样的树 URL 则标识一段特定的已持久化对话。

### 可选集成

以下能力均为按需配置，快速开始不需要它们：

- 深度研究：`SEARCH_API_KEY`（以及可选的 `SEARCH_BASE_URL`）
- 附件与 PDF 处理：Cloudflare R2 变量（`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`）
- 大文档向量检索：`EMBEDDINGS_BASE_URL`、`EMBEDDINGS_API_KEY`、`EMBEDDINGS_MODEL`，以及 PostgreSQL `pgvector`
- 其他模型提供商和网关：`.env.example` 中说明的提供商 key、Cloudflare AI Gateway 或 Vercel AI Gateway 变量
- 邮箱验证、Turnstile、Google 登录、计费和 Creem 支付：`.env.example` 中各功能对应的变量

请勿提交 `.env.local` 或任何凭据。

## 架构

项目基于 Next.js 16 App Router，使用 React、TypeScript、Tailwind CSS、Base UI 支撑的 shadcn 组件、assistant-ui、AI SDK、Drizzle ORM 和 PostgreSQL。

| 边界 | 位置 | 职责 |
| --- | --- | --- |
| 核心 | [`app/thread-chat/core/`](./app/thread-chat/core/) | 对话树状态、选择器和分支对话 store |
| 分支 | [`app/thread-chat/branching/`](./app/thread-chat/branching/) | 文本选择、锚点、上下文分支和分支感知的聊天渲染 |
| 编排 | [`app/thread-chat/orchestration/`](./app/thread-chat/orchestration/) | 多列工作区、树画布、切换、交付物和工作台控件 |
| 网络 | [`app/thread-chat/net/`](./app/thread-chat/net/) | 树加载、清理、防抖持久化、提示词和流式 UI 事件 |
| 服务端 | [`app/api/`](./app/api/) 和 [`lib/chat/`](./lib/chat/) | 认证、模型流式输出、工具处理、分支树 API、附件和研究工具 |

仓库内提供了更详细的设计材料：

- [ChatPDF 调研](./docs/chatpdf/01-调研报告.md)和[设计](./docs/chatpdf/02-设计方案.md)
- [深度研究设计](./docs/deep-research/设计说明.md)
- [OpenSpec 变更记录](./openspec/changes/)
- [项目开发指引](./CLAUDE.md)

## 状态与路线图

Thread Chat 正在积极开发中。当前仓库已包含已认证的聊天、持久化分支树、多列和画布工作区、Markdown 交付物、可选附件、深度研究、账户流程及计费集成。在稳定版本发布前，界面和运行集成仍可能继续演进。

当前方向包括加强自动化覆盖、完善部署和配置指引，以及持续优化不同屏幕尺寸下的分支工作区体验。请以 issue 跟踪器和已接受的 OpenSpec 变更作为计划工作的事实来源。

## 贡献

欢迎提交 issue 和 pull request。请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，其中说明了 pnpm 工作流、验证命令和贡献条款。

## 许可证

Copyright © 2026 hifizz。

Thread Chat 使用 [GNU Affero General Public License v3.0 only（AGPL-3.0-only）](./LICENSE)。本项目许可证不会替代或覆盖第三方依赖、资源或单独署名代码所适用的许可证和声明。
