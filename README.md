# Thread Chat

**Thread Chat is a branch-conversation workspace for following an idea without losing the conversation that led to it.** Select text in a response, branch from that context, and compare or navigate the resulting threads in columns or on a canvas.

> [中文文档](./README.zh-CN.md)

- Live product: <https://thread-chat.zilin.im/>
- Source repository: <https://github.com/hifizz/thread-chatbot>

## What it does

- **Start a new branch from any point in a response (with context).** Select a phrase, claim, example, or question to open a focused conversation that inherits everything up to that point. The branch can develop independently without cluttering or changing the original thread, and it can split again whenever another idea deserves its own path.
- **Navigate the whole conversation as a tree.** Keep important threads open side by side in resizable columns, use breadcrumbs and search to move between them, or zoom out to the canvas to see how every conversation connects and return to any branch.

## Status and roadmap

Thread Chat is under active development. The current repository includes authenticated chat, persisted branch trees, column and canvas workspaces, Markdown artifacts, optional attachments, deep research, account flows, and billing integrations. Interfaces and operational integrations may continue to evolve before a stable release.

Current directions include strengthening automated coverage, improving deployment and configuration guidance, and refining the branch-workspace experience across screen sizes. Treat the issue tracker and accepted OpenSpec changes as the source of truth for planned work.

### Roadmap

> Organized by theme. Priority tag: **P0** = highest priority.

#### P0 · High priority

- [ ] **Inherited-context compression** - Compress inherited branch context to lower multi-column conversation cost.
- [ ] **Project workspace** - Project-level goals and shared documents.
- [ ] **In-product memory** - Long-term memory geared toward project research.

#### Core features

- [ ] **Summarize & index** - Summarize a column or topic, with indexing and retention.
- [ ] **Multi-tenant & multi-user** - User isolation, with memory scoped per user/project.
- [ ] **Web search** - Bring web search into the conversation.
- [ ] **DeepResearch** - Add deep-research capability.
- [ ] **Skill system** - Web-based Skills and a built-in Skill Creator.
- [ ] **Sub-agent** - Create, monitor, and aggregate multiple Sub-agents.

#### Interactive Preview

- [ ] **Interactive Preview** - Render interactive visual artifacts within generated content.

#### Markdown & content rendering

- [ ] **Markdown rendering enhancements** - Refine rendering and essentials, including Mermaid.
- [ ] **Code-block highlighting** - Improve the code-block highlighting experience.
- [ ] **Markdown artifact display** - Refine panel placement and information density.
- [ ] **HTML generation & preview** - Support HTML generation and preview.

#### UI / UX interaction

- [ ] **Text-selection toolbar** - Quick action bubble on text selection.
- [ ] **Chat TOC** - Side directory navigation per conversation.
- [ ] **Scroll-to-bottom button** - Refine placement and appearance threshold.
- [ ] **Simplify input area** - Streamline the bottom input styling.
- [ ] **Overall UI micro-polish** - Fine-tune UI elements and interaction effects.

## Quick start

### Prerequisites

- Node.js `>=22`（开发、CI 与 VPS 推荐固定 Node.js 24）and [pnpm](https://pnpm.io/) (this repository declares `pnpm@10.32.1`)
- A PostgreSQL database
- Token Router credentials; the default model is GPT-5.6 Luna

Clone the repository and install dependencies:

```bash
git clone https://github.com/hifizz/thread-chatbot.git
cd thread-chatbot
pnpm install
cp .env.example .env.local
```

For the default minimum local setup, set these values in `.env.local`:

```dotenv
DATABASE_URL=postgres://...
DIRECT_URL=postgres://...
BETTER_AUTH_SECRET=replace-with-a-high-entropy-secret
BETTER_AUTH_URL=http://localhost:4040
TOKEN_ROUTER_BASE_URL=https://your-router.example/v1
TOKEN_ROUTER_API_KEY=...
```

`DATABASE_URL` is required by the running application. `pnpm db:migrate` uses `DIRECT_URL` when present and otherwise falls back to `DATABASE_URL`; use a direct database URL for migrations when your runtime URL is a transaction-pooler connection. The current model entry points require `TOKEN_ROUTER_BASE_URL` and `TOKEN_ROUTER_API_KEY`. The service must support the selected upstream model ID. Legacy provider settings remain documented in `.env.example` for existing deployments.

After the model-catalog migration has been integrated and verified on develop, apply migrations, initialize the catalog, and start the development server:

```bash
pnpm db:migrate
pnpm model-catalog:seed
pnpm dev
```

Open <http://localhost:4040/thread-chat> to enter the Thread Chat workspace. Sign in when prompted; the bare route resumes the most recently opened tree when available, while a tree URL such as `/thread-chat/{treeId}` identifies a specific persisted conversation.

### Bare-repository worktree development

Keep one shared `.env.local` in the bare-repository container directory. Each new worktree copies the complete file, then replaces its port, database URL, and authentication cookie prefix.

Create a branch and its worktree from any existing worktree. Pass the optional second argument to choose the branch, tag, or commit used as the starting point; it defaults to the current `HEAD`:

```bash
bash scripts/wt-new.sh feature/example main
```

The script allocates ports starting at 4041, creates an empty database in the OrbStack `thread-chat-pg` container, runs `pnpm db:push`, and registers the local test account configured in `.env.local`. Start the new environment with:

```bash
cd ../feature-example
pnpm dev
```

Remove the worktree and its database with:

```bash
bash scripts/wt-rm.sh feature/example
```

The removal script does not use `--force`; Git reports an error when the worktree contains uncommitted changes.

### Optional integrations

The following features are opt-in and are not required for the quick start:

- Web search and page fetch: AnySearch works anonymously; set `ANYSEARCH_API_KEY` for higher quotas and rate limits
- Attachments and PDF processing: Cloudflare R2 variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`)
- Large-document vector retrieval: `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_API_KEY`, and `EMBEDDINGS_MODEL`, plus PostgreSQL `pgvector`
- Additional model providers and gateways: provider keys, Cloudflare AI Gateway, or Vercel AI Gateway variables documented in `.env.example`
- Agent observability: local AI SDK DevTools and optional Langfuse Cloud tracing use the server-only variables documented in `.env.example`
- Email verification, Turnstile, Google sign-in, billing, and Creem payments: their feature-specific variables in `.env.example`

Do not commit `.env.local` or credentials.

### Agent observability and evaluation

The observability stack is opt-in and keeps production prompt/output content off by default. For the complete local DevTools, Langfuse Cloud, evaluation, acceptance, and incident-to-regression workflow, see [Agent observability operations](./docs/observability/08-operations-and-acceptance.md). The shortest safe checks are:

```bash
pnpm test:observability
pnpm test:agent-evals
pnpm observability:check-release
```

## Legacy OpenRouter models

The retained legacy registry contains fourteen fixed OpenRouter-backed internal model IDs (hidden from current model selectors; retirement is deferred): `openrouter-gpt-5.6-luna`, `openrouter-gpt-5.6-luna-pro`, `openrouter-gpt-5.6-terra`, `openrouter-gpt-5.6-terra-pro`, `openrouter-gpt-5.6-sol`, `openrouter-gpt-5.6-sol-pro`, `openrouter-gpt-5.5`, `openrouter-gpt-5.5-pro`, `openrouter-kimi-k3`, `openrouter-deepseek-v4-flash-0731`, `openrouter-qwen3.8-max`, `openrouter-grok-4.5`, `openrouter-grok-4.6`, and `openrouter-ox-alpha`. Configure `OPENROUTER_API_KEY`; `OPENROUTER_HTTP_REFERER` and `OPENROUTER_APP_TITLE` are optional attribution values. These IDs always use the dedicated OpenRouter provider—arbitrary external slugs are rejected. Ox Alpha uses upstream ID `stealth/ox-alpha` and is offered as a free, unbilled preview; completed requests for the other models use OpenRouter's real per-step USD cost when complete, with conservative static pricing as fallback. Attachments remain on the existing text-extraction path.

## LLM provider routing

The active model catalog is stored in PostgreSQL and managed at `/admin/models`. Administrators configure upstream IDs, request compatibility profiles, image/tool/reasoning abilities, effort options, and output limits/defaults. Chat and title generation read this catalog; the source registry only seeds initial data and retains legacy test/provider definitions. Existing public IDs stay stable. Gateway URLs and credentials remain server-only environment variables (`TOKEN_ROUTER_BASE_URL`, `TOKEN_ROUTER_API_KEY`).

A new model using an existing compatibility profile can be enabled without deploying application code. Each generation captures one configuration snapshot; menu data refreshes periodically, while the server validates enabled models and parameters on every new request. See [Admin setup, extension points and verification](./docs/admin/README.md), including the required develop migration integration before release.

## Architecture

The project is a Next.js 16 App Router application using React, TypeScript, Tailwind CSS, Base UI-backed shadcn components, assistant-ui, AI SDK, Drizzle ORM, and PostgreSQL.

| Boundary      | Location                                                             | Responsibility                                                                                    |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Core          | [`app/thread-chat/core/`](./app/thread-chat/core/)                   | Tree state, selectors, and the branch-conversation store                                          |
| Branching     | [`app/thread-chat/branching/`](./app/thread-chat/branching/)         | `selection/` owns text anchors and selection UI; `assistant/` owns branch-aware assistant rendering |
| Chat          | [`app/thread-chat/chat/`](./app/thread-chat/chat/)                   | `message/`, `composer/`, and `actions/` group the three conversation feature sets                 |
| Orchestration | [`app/thread-chat/orchestration/`](./app/thread-chat/orchestration/) | `canvas/`, `columns/`, `navigation/`, `artifacts/`, `overlays/`, and `workspace/` compose the workbench |
| Network       | [`app/thread-chat/net/`](./app/thread-chat/net/)                     | `boot/`, `commands/`, `persistence/`, `prompt/`, `stream/`, and `titles/` isolate client-side I/O |
| Server        | [`app/api/`](./app/api/) and [`lib/chat/`](./lib/chat/)              | Authentication, model streaming, tool handling, branch-tree APIs, attachments, and research tools |

Detailed design material is available in the repository:

- [ChatPDF research](./docs/chatpdf/01-调研报告.md) and [design](./docs/chatpdf/02-设计方案.md)
- [Deep research design](./docs/deep-research/设计说明.md)
- [OpenSpec change records](./openspec/changes/)
- [Project development guidance](./CLAUDE.md)


## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for the pnpm workflow, validation commands, and contribution terms.

## License

Copyright © 2026 hifizz.

Thread Chat is licensed under [GNU Affero General Public License v3.0 only (AGPL-3.0-only)](./LICENSE). This project license does not replace the licenses or notices that apply to third-party dependencies, assets, or separately attributed code.
