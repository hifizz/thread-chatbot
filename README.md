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
BETTER_AUTH_URL=http://localhost:4040
MINIMAX_API_KEY=...
```

`DATABASE_URL` is required by the running application. `pnpm db:migrate` uses `DIRECT_URL` when present and otherwise falls back to `DATABASE_URL`; use a direct database URL for migrations when your runtime URL is a transaction-pooler connection. `MINIMAX_BASE_URL` and `LLM_MODEL_ID` have defaults in `.env.example`, so they are not required for the default setup. A different configured model provider may be used instead of MiniMax, but the default model selection expects `MINIMAX_API_KEY`.

Apply migrations and start the development server:

```bash
pnpm db:migrate
pnpm dev
```

Open <http://localhost:4040/thread-chat> to enter the Thread Chat workspace. Sign in when prompted; the bare route resumes the most recently opened tree when available, while a tree URL such as `/thread-chat/{treeId}` identifies a specific persisted conversation.

### Optional integrations

The following features are opt-in and are not required for the quick start:

- Web search and page fetch: AnySearch works anonymously; set `ANYSEARCH_API_KEY` for higher quotas and rate limits
- Attachments and PDF processing: Cloudflare R2 variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`)
- Large-document vector retrieval: `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_API_KEY`, and `EMBEDDINGS_MODEL`, plus PostgreSQL `pgvector`
- Additional model providers and gateways: provider keys, Cloudflare AI Gateway, or Vercel AI Gateway variables documented in `.env.example`
- Email verification, Turnstile, Google sign-in, billing, and Creem payments: their feature-specific variables in `.env.example`

Do not commit `.env.local` or credentials.

## OpenRouter models

Thread Chat offers thirteen fixed OpenRouter-backed internal model IDs: `openrouter-gpt-5.6-luna`, `openrouter-gpt-5.6-luna-pro`, `openrouter-gpt-5.6-terra`, `openrouter-gpt-5.6-terra-pro`, `openrouter-gpt-5.6-sol`, `openrouter-gpt-5.6-sol-pro`, `openrouter-gpt-5.5`, `openrouter-gpt-5.5-pro`, `openrouter-kimi-k3`, `openrouter-deepseek-v4-flash-0731`, `openrouter-qwen3.8-max`, `openrouter-grok-4.5`, and `openrouter-grok-4.6`. Configure `OPENROUTER_API_KEY`; `OPENROUTER_HTTP_REFERER` and `OPENROUTER_APP_TITLE` are optional attribution values. These IDs always use the dedicated OpenRouter provider—arbitrary external slugs are rejected. GLM 5.3 is not included because OpenRouter does not currently list it. Completed requests use OpenRouter's real per-step USD cost when complete, with conservative static pricing as fallback. Attachments remain on the existing text-extraction path.

## UMAPIS preview models

The Thread Chat Prompt input model selector includes `umapis-claude-opus-4-6`, `umapis-claude-sonnet-5`, `umapis-gpt-5.6-sol`, and `umapis-gpt-5.6-terra`. Set `UMAPIS_API_KEY_CLAUDE` for the Claude models and `UMAPIS_API_KEY_GPT` for the GPT models; `UMAPIS_BASE_URL` is optional and accepts either the site root or the `/v1` API root. Requests use the upstream default behavior and do not send an Effort parameter. These models are unbilled previews: they do not require a positive user balance, do not debit credits, and do not display an unverified price. Effort configuration and UMAPIS billing belong to a later spec.

## Architecture

The project is a Next.js 16 App Router application using React, TypeScript, Tailwind CSS, Base UI-backed shadcn components, assistant-ui, AI SDK, Drizzle ORM, and PostgreSQL.

| Boundary      | Location                                                             | Responsibility                                                                                    |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Core          | [`app/thread-chat/core/`](./app/thread-chat/core/)                   | Tree state, selectors, and the branch-conversation store                                          |
| Branching     | [`app/thread-chat/branching/`](./app/thread-chat/branching/)         | Text selection, anchors, contextual branches, and branch-aware chat rendering                     |
| Orchestration | [`app/thread-chat/orchestration/`](./app/thread-chat/orchestration/) | Column workspace, tree canvas, switching, artifacts, and workbench controls                       |
| Network       | [`app/thread-chat/net/`](./app/thread-chat/net/)                     | Tree loading, sanitization, debounced persistence, prompts, and streaming UI events               |
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
