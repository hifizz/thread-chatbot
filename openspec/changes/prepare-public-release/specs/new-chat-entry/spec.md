## ADDED Requirements

### Requirement: Stable fresh-conversation entry
The application SHALL expose `/start-chat` as a stable entry that creates a new
UUID branch tree for every authenticated visit and redirects to
`/thread-chat/{treeId}`.

#### Scenario: Authenticated visitor starts from the homepage
- **WHEN** an authenticated visitor follows a landing-page “Start chatting” action
- **THEN** the application redirects them to a newly generated valid tree URL rather than the last-opened tree

#### Scenario: Visitor starts twice
- **WHEN** the same authenticated visitor completes the `/start-chat` flow twice
- **THEN** the two resulting tree IDs are different

### Requirement: Authentication preserves fresh-start intent
An unauthenticated `/start-chat` request SHALL redirect to sign-in with
`/start-chat` as its return target and SHALL create the new tree only after a real
session is present.

#### Scenario: Signed-out visitor starts from the homepage
- **WHEN** a signed-out visitor follows “Start chatting” and then signs in successfully
- **THEN** they return through `/start-chat` and arrive at a newly generated tree URL

### Requirement: Existing resume entry remains unchanged
The existing `/thread-chat` route MUST retain its current behavior of opening the
last remembered tree when available and creating a new tree otherwise.

#### Scenario: Returning user opens the workbench entry
- **WHEN** a user with a remembered tree visits `/thread-chat` directly
- **THEN** the remembered tree opens as before

### Requirement: Landing actions use the fresh entry
Every landing-page action labeled “Start chatting” SHALL target `/start-chat`,
while the GitHub action SHALL target
`https://github.com/hifizz/thread-chatbot`.

#### Scenario: Link targets are inspected
- **WHEN** a visitor inspects the hero and closing calls to action
- **THEN** all start actions resolve to `/start-chat` and all repository actions resolve to the canonical GitHub repository
