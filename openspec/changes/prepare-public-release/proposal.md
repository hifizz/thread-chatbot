## Why

The repository is now public, but its template-era README, sparse landing page, and
“resume the most recent tree” homepage CTA do not present Thread Chat as a coherent
public product. The project needs an accurate public identity, an explicit software
license, and a first-run path that always starts a fresh conversation.

## What Changes

- Replace the root README with an English-first product and contributor guide, link
  to a complete Chinese README, and document the live service, current capabilities,
  local setup, architecture, project status, and roadmap.
- License the repository under GNU AGPL Version 3 only, identify `hifizz` as the
  copyright holder, and document that inbound contributions use the same license
  without a CLA.
- Redesign `/` as an English product story in a research-notebook visual language,
  with “Start chatting” as the primary action and “View on GitHub” as the secondary
  action. The page will not display licensing or source-availability messaging.
- Add a dedicated authenticated `/start-chat` entry that always creates a new
  branch-tree URL, while preserving `/thread-chat` as the resume-last-tree entry.
- Update landing-page metadata and responsive presentation for an international
  Product Hunt, Hacker News, and GitHub audience.

## Capabilities

### New Capabilities

- `public-project-documentation`: English-first and Chinese public READMEs plus
  contribution guidance based on the repository's current implementation.
- `repository-licensing`: AGPL-3.0-only repository licensing and copyright metadata.
- `product-landing-page`: Product-led, research-notebook landing page with live
  product and GitHub calls to action.
- `new-chat-entry`: A stable entry route that creates a fresh conversation tree
  without changing the existing resume route.

### Modified Capabilities

None. There are no archived baseline specs under `openspec/specs/`; the earlier
landing-page change remains an unarchived historical change rather than a canonical
capability to modify.

## Impact

- Public documentation: `README.md`, `README.zh-CN.md`, `CONTRIBUTING.md`, and
  repository metadata in `package.json`.
- Licensing: a new root `LICENSE` containing the unmodified GNU AGPLv3 text.
- Landing presentation: `app/page.tsx`, `components/landing/*`,
  `constants/landing.ts`, landing-specific styling, and metadata.
- Navigation: `constants/routes.ts`, landing CTA links, and a new server-side
  `/start-chat` route.
- Authentication and persistence boundaries stay intact: branch-tree storage,
  `/thread-chat`, model APIs, billing, and the existing workbench are not redesigned.
- No new runtime dependency or client-side animation library is required.
