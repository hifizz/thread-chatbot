## ADDED Requirements

### Requirement: English-first root README
The repository SHALL provide an English `README.md` that introduces Thread Chat
as a branch-conversation product and links prominently to a complete Chinese
README.

#### Scenario: International visitor opens the repository
- **WHEN** a visitor opens the repository root on GitHub
- **THEN** the visitor sees an English product summary, a link labeled for Chinese documentation, and links to the live product and repository resources

### Requirement: README reflects the current product
Both README versions MUST describe the current implementation rather than the
earlier canned prototype, including real model responses, contextual branching,
column and canvas navigation, persisted trees, Markdown artifacts, and deep
research.

#### Scenario: Developer evaluates current capabilities
- **WHEN** a developer reads either README
- **THEN** the documented capabilities match features present in the current repository and do not claim that AI replies are hard-coded

### Requirement: Reproducible local setup
Both README versions SHALL document prerequisites, pnpm commands, minimum
required configuration, database migration, development startup, and the
`/thread-chat` experience route without exposing secrets.

#### Scenario: Developer follows quick start
- **WHEN** a developer starts from a clean clone and follows the documented setup with valid external-service credentials
- **THEN** the documented commands are sufficient to install dependencies, prepare the database, start the application, and locate Thread Chat

### Requirement: Public architecture and status
Both README versions SHALL provide a concise current architecture map, project
status, roadmap, and links to detailed in-repository documentation.

#### Scenario: Contributor scopes a change
- **WHEN** a prospective contributor reads the architecture section
- **THEN** they can identify the core, branching, orchestration, network, and server boundaries without relying on the obsolete handoff state

### Requirement: Contribution terms
The repository SHALL include `CONTRIBUTING.md` stating that issues and pull
requests are welcome and that submitted contributions use AGPL-3.0-only without
a CLA.

#### Scenario: Contributor prepares a pull request
- **WHEN** a contributor reads `CONTRIBUTING.md`
- **THEN** they can identify the development checks and the license that applies to their contribution
