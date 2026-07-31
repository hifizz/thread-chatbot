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

### 路线图

> 按主题分类，优先级标记：**P0** = 最高优先。

#### P0 · 高优先级

- [ ] **P0 继承上下文压缩算法** - 研究如何实现继承上下文的压缩，减少每次开新的一列发新消息时因集成上下文而导致的成本暴增。
- [ ] **P0 Project 形态** - 希望 ThreadChat 变成一个 Project 的形态，类似 Claude Web 网页版的 Project 产品形态：
  - [ ] 支持设置目标（即一段类似项目注入的 Prompt）
  - [ ] 支持增加公共共享文档（参考 Claude Project 的运作方式）
  - [ ] 在主线 UI 上添加UX/UI操作入口
- [ ] **P0 产品内记忆系统** - 设计并实现产品内的记忆，让用户拥有更符合 project 研究的记忆使用体验。

#### 核心功能

- [ ] **内容总结与索引** - 在 skill 或 prompt input 中添加功能：让用户能快速总结一列或一个主题的讨论内容与结果；甚至把总结内容用某种方式索引到主线或其他列（如通过 `@` 引用），或总结成记忆。
- [ ] **多租户与多用户架构** - 设计并实现多租户、多用户架构；不同用户的隔离，以及每个用户不同 project 的记忆设计（记忆可基于 project，也可基于整个用户），需单独设计。
- [ ] **联网搜索** - 给 prompt input 增加联网功能按钮或自动开启联网搜索。重点调研现在接入的两个厂商：MiniMax 的 Coding Plan 与火山引擎方舟的 Coding Plan。
  - 不考虑 Coding Plan 能否上生产，仅作 demo。需要知道：
    1. 用这些 API 如何实现联网搜索？
    2. 后续换成真实第三方 API 转发商，每次回答都带联网搜索的话，成本如何？如何降低成本？
    3. Claude 是否因本身带有搜索缓存而降低成本？
    4. 希望智能且平衡成本地实现，类似 Claude Opus 在回答问题前经常性联网查询最新知识。
    5. 全面调研业界做法与分层：前后端、架构设计、系统设计、模型能力/自建服务、第三方搜索 API、成本平衡、性能/速度/质量等，再进入结合本项目的实际调研。
- [ ] **DeepResearch 迁移** - 把 DeepResearch 搜索功能迁移进来。
- [ ] **Skill 系统** - 支持网页版本的 Skill，并内置 Skill Creator。
- [ ] **Sub-agent 调用** - 研究如何在 Web Chatbot 里实现调用 Sub-agent 的功能。主要关注：
  1. **创建与规划**：用户在输入框输入指令（如“启动一个 Sub-agent 去分批实现我上面的任务”），系统接收后对任务拆分和规划，决定如何启动这些 Sub-agent 并付诸执行。
  2. **状态监听与 UI 展示**：系统持续监听 Sub-agent 运行状态和信息；UI 直观展示（如界面上出现三个“胶囊”图标代表三个 Sub-agent）；点击每个“胶囊”时右侧弹出 Panel（抽屉组件），提示和展示该 Sub-agent 正在做什么及其他必备信息。
  3. **结果汇总**：所有 Sub-agent 任务全部完成后，主线 Agent 收集并汇总所有任务结果，统一报告，流程结束。
  - **待调研**：前端、协议层（Tool Use 的定义以及 Artifact）与后端之间究竟如何启动一个 Sub-agent？Sub-agent 在具体实践中大概是什么样的（请用伪代码展示）？后端启动后彼此如何通信和交流？

#### Interactive Preview（核心功能）

- [ ] **调研并实现类似 Claude 的 Interactive Preview** - 后续实现类似 Claude 的 interactive preview 功能：在生成的内容里自动生成可交互的可视化产物（如 SVG）。
  - 先调研 Claude 的 Interactive Preview 是如何实现的。
  - 待确认：是否独立于 Markdown 产物体系，还是作为其上层能力；安全沙箱与交互范围；触发方式（自动识别 vs 显式指令）。

#### Markdown 与内容渲染

- [ ] **完善 Markdown 渲染** - 完善、优化 Markdown 的渲染和必备功能。
  - [ ] 实现 Mermaid 渲染与 system Prompt 定义。
- [ ] **调研代码块高亮** - 调研并研究现在代码块高亮都是如何实现的。
- [ ] **优化 Markdown 产物展示**
  - 产物 Panel 位置：用户点击 Markdown button 展示产物 panel 时，不应默认放到右半边，应看点击位置放置，尽量不挡住用户正在关注的这一列聊天。
  - 重新思考 Markdown Panel 需要展示哪些信息：现在界面元素浪费空间有点多，而本产品定位是高密度、高信息量，需注意用户空间。
- [ ] **HTML 生成与 Preview** - 后续是否需要实现生成 HTML 的功能？如何渲染展示 preview？

#### UI / UX 交互

- [ ] **选中文本 Toolbar** - 用户划选文本任意位置后弹出的气泡，目前是一个输入框（dialog），希望后续变成类似 ChatGPT 的功能气泡（工具栏），含三个小工具：
  1. 引用内容追问
  2. 开启分支追问
  3. 高亮：四个圆饼状小图标对应不同颜色，点击对应颜色圈圈后，划选的那段文本高亮成对应颜色；后续可扩展为点击颜色高亮后弹出小 dialog 让用户做笔记等。
- [ ] **Chat TOC** - 设计并实现每一个 chat 的 TOC，在右边界展示一系列原点。
- [ ] **滚动到底部按钮优化** - 每列不在最底部时显示“点击立刻跳到底部”按钮：
  - 位置从列最右侧改到这一列的最中间。
  - 滚动阈值：当前滚到 99% 仍未完全到 100% 时不显示按钮，需要设置合理阈值。
- [ ] **输入框区域简化** - model input 所在的底部按理不需要 border-top 和 background，就一个 input 带阴影即可。
- [ ] **整体 UI 微优化** - 微优化整体 UI 界面，尤其是一些 UI 元素和交互效果。

## 贡献

欢迎提交 issue 和 pull request。请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，其中说明了 pnpm 工作流、验证命令和贡献条款。

## 许可证

Copyright © 2026 hifizz。

Thread Chat 使用 [GNU Affero General Public License v3.0 only（AGPL-3.0-only）](./LICENSE)。本项目许可证不会替代或覆盖第三方依赖、资源或单独署名代码所适用的许可证和声明。
