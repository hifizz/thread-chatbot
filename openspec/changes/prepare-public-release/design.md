## Context

Thread Chat is already a production-shaped Next.js 16 application: it has real
model streaming, authenticated and persisted branch trees, column and canvas
workspaces, bubble branching, Markdown artifacts, attachments, deep research,
billing, and account flows. Its public surface does not reflect that maturity.
`README.md` still begins as a generic template, the landing page is a minimal
placeholder, and its CTA targets `/thread-chat`, whose redirect intentionally
restores the most recently opened tree.

The repository has just become public. The public release therefore needs to
serve two audiences without conflating them:

- product visitors arriving through Product Hunt, Hacker News, or the live site;
- developers evaluating, running, or contributing to the GitHub repository.

Project-wide constraints remain in force: Next.js 16 App Router, static server
components by default, Tailwind CSS v4, Base UI-backed shadcn components, pnpm,
and no runtime dependency unless the product requires it.

## Goals / Non-Goals

**Goals:**

- Make the live landing page explain the branch-conversation product within one
  viewport and carry that story through columns, canvas, and real-work features.
- Establish a recognizable research-notebook visual identity that matches the
  workbench's paper, ink, selection highlight, footnote, and depth-color language.
- Publish accurate English-first and Chinese repository documentation.
- Apply AGPL-3.0-only consistently to the repository and inbound contributions.
- Give homepage visitors a reliable “new conversation” path without changing
  the existing resume behavior of `/thread-chat`.
- Keep the landing page static, responsive, accessible, and inexpensive to load.

**Non-Goals:**

- Redesign the authenticated Thread Chat workbench, account, billing, or auth UI.
- Add a marketing CMS, analytics SDK, animation framework, video, or WebGL effect.
- Display licensing or source-availability messaging on the product landing page.
- Introduce a CLA, dual licensing, or a commercial-license workflow.
- Change branch-tree persistence, model routing, or conversation semantics.

## Decisions

### D1. Separate product acquisition from repository onboarding

The live landing page will remain product-led: its primary action is
“Start chatting” and its secondary action is “View on GitHub.” Repository
licensing, setup, architecture, and contribution details stay in GitHub
documentation.

The alternative—placing license and self-hosting details in the landing
narrative—was rejected because it dilutes the product's first-use story and the
user explicitly wants licensing discoverable from the repository instead.

### D2. Use an English-first product story with a complete Chinese mirror

`README.md` and the landing page will use English as their primary language.
`README.md` will expose a prominent `中文文档` link to `README.zh-CN.md`, whose
structure and factual claims mirror the English document.

The README will describe the current repository, not the handoff document's
earlier “canned prototype” state. Detailed subsystems remain linked rather than
copying all internal operational notes into the public introduction.

### D3. Build the landing page from static, bounded sections

The page remains a server-rendered composition with the following reading order:

1. compact navigation;
2. hero with value proposition and a branch interaction visual;
3. Select → Branch → Navigate interaction sequence;
4. multi-column comparison showcase;
5. canvas tree showcase;
6. focused capability proof for live models, persistence, Markdown artifacts,
   and deep research;
7. closing product and GitHub calls to action.

The visuals will be semantic HTML and CSS rather than screenshots posing as
interactive controls. Shared landing content stays in `constants/landing.ts`;
shared landing visuals stay locally scoped so the workbench's `.tc` theme and
global shadcn tokens remain unaffected.

Alternatives considered:

- A single oversized interactive demo would increase client JavaScript and
  maintenance while leaving first-time visitors with less explanatory context.
- A developer-tool landing page would optimize GitHub conversion at the expense
  of the hosted product and Product Hunt positioning.

### D4. Treat research-notebook styling as a landing-specific visual system

The landing root will define warm paper, ink, muted annotation, highlighter, and
branch-depth tokens. Typography will reuse fonts already loaded by the
application; no font or animation dependency will be added. Fine rules, paper
texture, footnote numbers, highlight strokes, and connector paths will be
implemented in CSS with reduced-motion-safe transitions.

Desktop sections may use paired copy and visual panels. Small screens collapse
to a single narrative column; desktop column layouts will not be squeezed into
unreadable mobile mockups.

### D5. Add a dedicated server-side fresh-conversation entry

The landing CTA will target a stable `/start-chat` route. That server route will:

1. verify the real authenticated session;
2. redirect unauthenticated requests to sign-in with `/start-chat` as the return
   target;
3. generate a new UUID for authenticated requests;
4. redirect to `/thread-chat/{treeId}`.

This is preferred over generating UUIDs in the CTA client because the landing
page can stay static and server-only, login return behavior is deterministic,
and direct links to the entry remain useful. `/thread-chat` keeps its existing
“last tree or new tree” redirect so bookmarks and workbench entry behavior do
not regress.

### D6. Apply the standard AGPLv3 text without a CLA

The root `LICENSE` will contain the unmodified GNU Affero General Public License
Version 3 text. Repository metadata will use the SPDX expression
`AGPL-3.0-only`, and public documentation will identify `hifizz` as the 2026
copyright holder.

`CONTRIBUTING.md` will state that submitted contributions are offered under the
same AGPL-3.0-only terms. No CLA is introduced. This means the project cannot
later relicense external contributions unilaterally, which is an accepted
trade-off of the selected single-license model.

`package.json` remains `"private": true`; that flag prevents accidental package
publication and does not conflict with public source licensing.

## Risks / Trade-offs

- **[AGPL permits commercial competitors that publish corresponding source]** →
  This is an explicit, accepted property of the selected license; README wording
  will not imply a commercial-use prohibition or revenue-sharing obligation.
- **[Future relicensing becomes difficult after external contributions]** →
  Keep inbound and outbound licensing aligned and document the no-CLA choice
  clearly.
- **[Public README drifts from implementation]** → Describe stable product
  capabilities, link detailed subsystem documents, and avoid volatile provider
  prices or operational implementation detail.
- **[Landing visuals become decorative but unclear]** → Every showcase pairs a
  concrete action with explanatory copy and preserves semantic reading order.
- **[Landing CSS leaks into the workbench]** → Scope the visual system to the
  landing root and avoid changing shared application tokens for marketing needs.
- **[Fresh-chat redirect regresses resume behavior]** → Add `/start-chat` as a
  separate entry and leave `TreeRedirect` unchanged.
- **[Authentication redirect loops on stale cookies]** → The start route performs
  the same server-side session validation as other protected pages and returns
  to itself after sign-in.

## Migration Plan

1. Add the license, bilingual documentation, contribution guide, and package
   metadata.
2. Add route and landing content contracts before replacing presentation
   components.
3. Implement `/start-chat` and point only landing “Start chatting” actions to it.
4. Replace the landing composition and scoped styles section by section.
5. Run static checks, production build, route assertions, responsive visual QA,
   and relevant existing Thread Chat regressions.
6. Deploy normally; no database migration or environment-variable change is
   required.

Rollback is a code revert. No persisted data changes, URL identity changes, or
database migrations are involved. Existing `/thread-chat/{treeId}` URLs remain
valid throughout.

## Open Questions

None. Language, product positioning, visual direction, live URL, GitHub URL,
copyright identity, landing license visibility, and AGPLv3 choice have all been
confirmed.
