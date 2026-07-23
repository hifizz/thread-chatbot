# Thread Chat

**Thread Chat is a branch-conversation workspace for following an idea without losing the conversation that led to it.** Select text in a response, branch from that context, and compare or navigate the resulting threads in columns or on a canvas.

> [中文文档](./README.zh-CN.md)

- Live product: <https://thread-chat.zilin.im/>
- Source repository: <https://github.com/hifizz/thread-chatbot>

## What it does

- Streams real model responses; the default local configuration uses MiniMax, with additional configured providers available through the model registry.
- Creates contextual branches from selected response text, preserving the relevant source context for each branch.
- Lets you work across multiple conversation columns or inspect and navigate the complete tree in a canvas view.
- Persists branch trees in PostgreSQL so conversations can be loaded again after a refresh; tree identity is carried in `/thread-chat/{treeId}`.
- Produces Markdown artifacts directly in Thread Chat and keeps completed artifacts with the assistant message that created them.
- Offers optional deep-research mode with multi-step web search and page reading, presenting source-backed results when a search provider is configured.
- Supports optional attachments, including PDF text extraction, summaries, suggested questions, citations, and optional vector retrieval for large documents.

Thread Chat is not a canned-response demo: model requests are handled by the server and the branch workspace persists its state through the application's APIs.

## Quick start

### Prerequisites

- Node.js `>=20.9.0` and [pnpm](https://pnpm.io/) (this repository declares `pnpm@10.32.1`)
- A PostgreSQL database
- Credentials for at least one supported model provider; the default model uses MiniMax

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
BETTER_AUTH_URL=http://localhost:3000
MINIMAX_API_KEY=...
```

`DATABASE_URL` is required by the running application. `pnpm db:migrate` uses `DIRECT_URL` when present and otherwise falls back to `DATABASE_URL`; use a direct database URL for migrations when your runtime URL is a transaction-pooler connection. `MINIMAX_BASE_URL` and `LLM_MODEL_ID` have defaults in `.env.example`, so they are not required for the default setup. A different configured model provider may be used instead of MiniMax, but the default model selection expects `MINIMAX_API_KEY`.

Apply migrations and start the development server:

```bash
pnpm db:migrate
pnpm dev
```

Open <http://localhost:3000/thread-chat> to enter the Thread Chat workspace. Sign in when prompted; the bare route resumes the most recently opened tree when available, while a tree URL such as `/thread-chat/{treeId}` identifies a specific persisted conversation.

### Optional integrations

The following features are opt-in and are not required for the quick start:

- Deep research: `SEARCH_API_KEY` (and optionally `SEARCH_BASE_URL`)
- Attachments and PDF processing: Cloudflare R2 variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`)
- Large-document vector retrieval: `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_API_KEY`, and `EMBEDDINGS_MODEL`, plus PostgreSQL `pgvector`
- Additional model providers and gateways: provider keys, Cloudflare AI Gateway, or Vercel AI Gateway variables documented in `.env.example`
- Email verification, Turnstile, Google sign-in, billing, and Creem payments: their feature-specific variables in `.env.example`

Do not commit `.env.local` or credentials.

## Architecture

The project is a Next.js 16 App Router application using React, TypeScript, Tailwind CSS, Base UI-backed shadcn components, assistant-ui, AI SDK, Drizzle ORM, and PostgreSQL.

| Boundary | Location | Responsibility |
| --- | --- | --- |
| Core | [`app/thread-chat/core/`](./app/thread-chat/core/) | Tree state, selectors, and the branch-conversation store |
| Branching | [`app/thread-chat/branching/`](./app/thread-chat/branching/) | Text selection, anchors, contextual branches, and branch-aware chat rendering |
| Orchestration | [`app/thread-chat/orchestration/`](./app/thread-chat/orchestration/) | Column workspace, tree canvas, switching, artifacts, and workbench controls |
| Network | [`app/thread-chat/net/`](./app/thread-chat/net/) | Tree loading, sanitization, debounced persistence, prompts, and streaming UI events |
| Server | [`app/api/`](./app/api/) and [`lib/chat/`](./lib/chat/) | Authentication, model streaming, tool handling, branch-tree APIs, attachments, and research tools |

Detailed design material is available in the repository:

- [ChatPDF research](./docs/chatpdf/01-调研报告.md) and [design](./docs/chatpdf/02-设计方案.md)
- [Deep research design](./docs/deep-research/设计说明.md)
- [OpenSpec change records](./openspec/changes/)
- [Project development guidance](./CLAUDE.md)

## Status and roadmap

Thread Chat is under active development. The current repository includes authenticated chat, persisted branch trees, column and canvas workspaces, Markdown artifacts, optional attachments, deep research, account flows, and billing integrations. Interfaces and operational integrations may continue to evolve before a stable release.

Current directions include strengthening automated coverage, improving deployment and configuration guidance, and refining the branch-workspace experience across screen sizes. Treat the issue tracker and accepted OpenSpec changes as the source of truth for planned work.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for the pnpm workflow, validation commands, and contribution terms.

## License

Copyright © 2026 hifizz.

Thread Chat is licensed under [GNU Affero General Public License v3.0 only (AGPL-3.0-only)](./LICENSE). This project license does not replace the licenses or notices that apply to third-party dependencies, assets, or separately attributed code.
