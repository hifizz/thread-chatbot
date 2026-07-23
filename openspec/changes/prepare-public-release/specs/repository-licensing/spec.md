## ADDED Requirements

### Requirement: Standard AGPLv3 license
The repository MUST contain a root `LICENSE` with the unmodified GNU Affero
General Public License Version 3 text.

#### Scenario: License scanner inspects the repository
- **WHEN** GitHub or another SPDX-aware scanner reads the repository
- **THEN** it can identify the project license as GNU AGPL Version 3

### Requirement: Consistent SPDX metadata
Repository metadata and public documentation SHALL identify the project license
as `AGPL-3.0-only`.

#### Scenario: Developer checks package metadata
- **WHEN** a developer reads `package.json` and the README license section
- **THEN** both identify the same AGPL-3.0-only license without a noncommercial or revenue-sharing restriction

### Requirement: Copyright identity
Public repository documentation SHALL identify `hifizz` as the copyright holder
for 2026.

#### Scenario: Downstream user checks attribution
- **WHEN** a downstream user looks for the project's copyright identity
- **THEN** they can find `Copyright © 2026 hifizz` in the public repository materials

### Requirement: Third-party licenses remain independent
Project licensing documentation MUST NOT claim to replace or override the
licenses of third-party dependencies, assets, or separately attributed code.

#### Scenario: Downstream user audits dependencies
- **WHEN** the project includes a third-party package under another compatible license
- **THEN** that package continues to be governed by its own license and notices
