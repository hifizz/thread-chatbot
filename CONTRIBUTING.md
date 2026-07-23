# Contributing to Thread Chat

Issues and pull requests are welcome. Please use the repository's pnpm-based workflow and keep changes focused on a single problem.

## Development workflow

1. Fork the repository and create a focused branch.
2. Install dependencies with `pnpm install`.
3. Copy `.env.example` to `.env.local` and configure the services required for the area you are changing. The minimum local chat setup requires PostgreSQL, authentication settings, and a configured model provider; see [README.md](./README.md#quick-start).
4. When a schema change is required, generate or apply migrations with the documented `pnpm db:*` commands. Do not include unrelated generated changes.
5. Make the smallest coherent change and update relevant documentation or OpenSpec material when applicable.

Use pnpm for repository commands; do not substitute npm or yarn.

## Checks

Before opening a pull request, run the applicable project checks:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm openspec:validate
```

There is currently no separate test framework configured. For changed TypeScript or TSX files, run `pnpm format` only as the final formatting step before submitting; it writes files. Include in the pull request description any validation you could not run and why.

## Issues and pull requests

- Search existing issues and OpenSpec changes before starting duplicate work.
- Describe the problem, the behavior change, and any migration, environment, or user-facing impact.
- Keep pull requests reviewable; avoid unrelated refactors and do not commit secrets, `.env.local`, or credentials.
- Update documentation when commands, configuration, public behavior, or architecture boundaries change.
- Be respectful and provide enough context for another contributor to reproduce the result.

## License and CLA

Copyright © 2026 hifizz.

By submitting a contribution, you offer your contribution under the same **AGPL-3.0-only** terms as Thread Chat. No contributor license agreement (CLA) is required or requested. This repository license does not replace the licenses or notices that apply to third-party dependencies, assets, or separately attributed code.
