## 1. Contracts and Routing

- [x] 1.1 Read the bundled Next.js 16 guides required by `plan.md` and verify the server redirect, request dynamism, metadata, Link, and CSS Module patterns before editing App Router code
- [x] 1.2 Add `constants/project.ts`, extend `ROUTES` with `startChat`, and add the typed `threadTreeRoute` builder exactly as defined in `plan.md`
- [x] 1.3 Replace the landing content model and English content in `constants/landing.ts` with the approved navigation, hero, steps, showcases, capabilities, and closing CTA contracts
- [x] 1.4 Implement the authenticated, per-request `/start-chat` redirect and verify that `/thread-chat` resume behavior is unchanged
- [x] 1.5 Run `pnpm typecheck` for the contract and routing batch and fix all errors before continuing

## 2. License and Public Documentation

- [x] 2.1 Add the unmodified GNU AGPL Version 3 text as root `LICENSE`, declare `AGPL-3.0-only` in `package.json`, retain `"private": true`, and record `Copyright © 2026 hifizz`
- [x] 2.2 Rewrite `README.md` as the English-first public product guide with a prominent Chinese link, live demo, current feature set, quick start, architecture, status, roadmap, contribution, and license sections
- [x] 2.3 Add `README.zh-CN.md` as a complete factual mirror of the English README rather than a shortened translation
- [x] 2.4 Add `CONTRIBUTING.md` with the pnpm development workflow, required checks, issue/PR expectations, AGPL-3.0-only inbound terms, and explicit no-CLA policy
- [x] 2.5 Verify README commands, environment-variable requirements, internal documentation links, external URLs, feature claims, and license identifiers against the current repository

## 3. Product Landing Page

- [x] 3.1 Add the scoped research-notebook visual system in `components/landing/landing.module.css`, including paper, ink, highlight, annotation, connector, depth-color, focus, responsive, and reduced-motion rules
- [x] 3.2 Implement the landing header and hero with an immediate selection-to-branch visual, `/start-chat` primary CTA, and canonical GitHub secondary CTA
- [x] 3.3 Implement the Select → Branch → Navigate interaction sequence and the multi-column workspace showcase with semantic, non-interactive presentation
- [x] 3.4 Rebuild the canvas showcase to communicate tree overview and navigation without loading the authenticated React Flow workbench
- [x] 3.5 Rebuild the capability grid around real models, persisted trees, Markdown artifacts, and deep research
- [x] 3.6 Implement the closing CTA and footer, keeping license/source-availability messaging off the landing page
- [x] 3.7 Replace `app/page.tsx` composition and metadata, then remove obsolete landing component code and unused exports
- [x] 3.8 Run `pnpm typecheck` for the complete landing-page batch and fix all errors before continuing

## 4. Quality and Regression Verification

- [x] 4.1 Sweep modified modules for duplicated route literals, URLs, content strings, icon mappings, and magic visual values; consolidate them according to `CLAUDE.md`
- [x] 4.2 Run Prettier only on the changed TypeScript and TSX files after implementation is complete
- [x] 4.3 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm openspec:validate`; resolve all actionable failures
  - `typecheck`, the changed-file ESLint scope, the production build, and all 13 strict OpenSpec validations pass. The repository-wide lint command still reports pre-existing failures in unrelated assistant UI, account, carousel, layout, and mobile-hook modules; no changed file is among them.
- [ ] 4.4 Verify signed-out and authenticated `/start-chat` behavior, including two distinct UUID results, and confirm direct `/thread-chat` still resumes the remembered tree
  - Signed-out browser behavior passes and preserves `redirect=/start-chat`. The authenticated browser assertions are implemented in `e2e/public-release/verify-public-release.mjs` but remain an environment-only skip until a safe `PLAYWRIGHT_STORAGE_STATE` is supplied. Source review confirms the route creates a per-request `randomUUID()` and no existing `/thread-chat` module was modified.
- [x] 4.5 Perform desktop and mobile visual QA at the widths listed in `plan.md`, including keyboard focus, heading order, reduced motion, contrast, and horizontal overflow
  - Browser QA passes at 1440 px and 390 px. The heading sequence has no skipped levels, keyboard focus is visibly outlined, reduced-motion durations are capped, sampled headline/primary-CTA contrast exceeds 14:1, and neither viewport overflows horizontally.
- [x] 4.6 Run relevant existing Thread Chat persistence/live smoke scripts when environment prerequisites are available and record any environment-only skips
  - All four pure Thread Chat regression scripts pass. The Markdown Artifact browser script is not runnable against the current authenticated server layout with its legacy fake cookie, and live/persistence scripts were skipped because they require a real authenticated account plus external model/database access.
- [x] 4.7 Confirm the final diff contains only public-release scope and does not modify branch-tree data, workbench behavior, billing, model routing, or unrelated user changes
