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

- [ ] **P0 Inherited-context compression** — Research how to compress inherited context, reducing the cost blowup from integrating context every time a new column is opened and a new message is sent.
- [ ] **P0 Project form** — Make ThreadChat take a Project form, similar to the Project product shape on Claude's web app:
  - [ ] Support setting a goal (i.e., a project-injection prompt)
  - [ ] Support adding shared documents (modeled on how Claude Projects work)
  - [ ] Add a UX/UI interaction entry point on the main-line UI
- [ ] **P0 In-product memory system** — Design and implement in-product memory so users get a memory experience better suited to project research.

#### Core features

- [ ] **Summarize & index content** — Add a capability in skill or prompt input that lets users quickly summarize the discussion and results of a column or topic; even index the summary back to the main line or other columns (e.g., via `@` references), or turn it into memory.
- [ ] **Multi-tenant & multi-user architecture** — Design and implement a multi-tenant, multi-user architecture; per-user isolation, and memory design across a user's different projects (memory may be project-scoped or user-scoped), needs dedicated design.
- [ ] **Web search** — Add a web-search toggle to prompt input, or enable it automatically. Focus on the two currently integrated providers: MiniMax's Coding Plan and Volcengine Ark's Coding Plan.
  - Setting aside whether Coding Plan is production-ready; this is just a demo. Need to know:
    1. How to implement web search with these APIs?
    2. If we later switch to a real third-party API forwarder, what's the per-answer cost when every answer includes web search, and how to lower it?
    3. Does Claude lower cost via its own search cache?
    4. Goal: implement web search intelligently with balanced cost, like Claude Opus frequently querying for up-to-date knowledge before answering.
    5. Survey industry approaches and layering end-to-end — frontend/backend, architecture design, system design, model capability / self-built service, third-party search APIs, cost balancing, performance/speed/quality — before scoping a project-specific implementation.
- [ ] **Migrate DeepResearch** — Bring the DeepResearch search capability into this product.
- [ ] **Skill system** — Support web-based Skills, and ship a built-in Skill Creator.
- [ ] **Sub-agent invocation** — Research how to implement Sub-agent invocation in a web chatbot. Key concerns:
  1. **Creation & planning**: the user issues an instruction (e.g., "launch a Sub-agent to batch-implement the tasks above"); the system receives it, decomposes and plans the tasks, and decides how to launch the Sub-agents and execute them.
  2. **Status monitoring & UI**: the system continuously monitors Sub-agent status and messages; the UI presents it visually (e.g., three "capsule" icons for three Sub-agents); clicking a capsule opens a right-side Panel (drawer) showing what that Sub-agent is doing and other essentials.
  3. **Result aggregation**: once all Sub-agents finish, the main-line Agent collects and aggregates all results into a unified report, ending the flow.
  - **To investigate**: how exactly is a Sub-agent started across the frontend, protocol layer (Tool Use definitions and Artifacts), and backend? What does a Sub-agent look like in practice (show pseudocode)? After backend launch, how do they communicate with each other?

#### Interactive Preview (core feature)

- [ ] **Investigate and implement a Claude-like Interactive Preview** — Later implement an interactive-preview feature like Claude's: auto-generate interactive visual artifacts (e.g., SVG) within generated content.
  - First investigate how Claude's Interactive Preview is implemented.
  - To confirm: is it independent of the Markdown-artifact system, or a layer on top; sandboxing and interaction scope; trigger mode (auto-detect vs. explicit instruction).

#### Markdown & content rendering

- [ ] **Improve Markdown rendering** — Refine and optimize Markdown rendering and essential features.
  - [ ] Implement Mermaid rendering with a system prompt definition.
- [ ] **Survey code-block highlighting** — Research how code-block highlighting is currently implemented.
- [ ] **Optimize Markdown artifact display**
  - Artifact panel position: when the user clicks the Markdown button to show the artifact panel, it shouldn't default to the right half; place it based on click position and avoid covering the column the user is focused on.
  - Rethink what the Markdown panel needs to show: current UI elements waste space; this is a high-density, high-information product, so screen real estate matters.
- [ ] **HTML generation & preview** — Do we need an HTML-generation feature later? How to render and show a preview?

#### UI / UX interaction

- [ ] **Text-selection toolbar** — The bubble that appears after selecting text anywhere is currently an input (dialog); make it a ChatGPT-style action bubble (toolbar) with three small tools:
  1. Quote and follow up
  2. Branch and follow up
  3. Highlight: four dot icons for different colors; clicking a color highlights the selected text in that color; later extend to popping a small dialog for notes on highlight.
- [ ] **Chat TOC** — Design and implement a TOC for each chat, showing a series of dots on the right edge.
- [ ] **Scroll-to-bottom button** — When a column isn't at the bottom, show a "jump to bottom" button:
  - Move it from the far right of the column to the center of the column.
  - Scroll threshold: currently the button doesn't appear at 99% (not fully 100%); set a sensible threshold.
- [ ] **Simplify input area** — The bottom area with the model input shouldn't need a border-top and background; a single shadow-bordered input is enough.
- [ ] **Overall UI micro-polish** — Micro-optimize the overall UI, especially UI elements and interaction effects.

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


## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for the pnpm workflow, validation commands, and contribution terms.

## License

Copyright © 2026 hifizz.

Thread Chat is licensed under [GNU Affero General Public License v3.0 only (AGPL-3.0-only)](./LICENSE). This project license does not replace the licenses or notices that apply to third-party dependencies, assets, or separately attributed code.
