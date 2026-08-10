## ADDED Requirements

### Requirement: Thread Chat SHALL default to proactive automatic search
The system SHALL support `auto`, `always`, and `off` Web Search modes for Thread Chat, SHALL default new conversations to `auto`, and SHALL validate the selected mode on the server. In `auto`, GLM-5.2 SHALL decide whether search is necessary; in `always`, the first model step SHALL perform one search; in `off`, the search tool SHALL not be exposed.

#### Scenario: Version-sensitive programming question in auto mode
- **WHEN** a user asks about the current behavior of a versioned framework or library in `auto` mode
- **THEN** GLM-5.2 can call Web Search before answering and bases current claims on returned sources

#### Scenario: Stable conceptual question in auto mode
- **WHEN** a user asks a timeless programming concept that does not depend on external current facts
- **THEN** GLM-5.2 can answer without invoking Web Search

#### Scenario: User disables search
- **WHEN** the request selects `off`
- **THEN** the server does not expose or execute the Web Search tool for that response

#### Scenario: User forces search
- **WHEN** the request selects `always`
- **THEN** the first model step performs exactly one forced search before later steps return to automatic tool choice

### Requirement: Search policy SHALL be server-owned and date-aware
The server SHALL inject the current ISO date and timezone, search decision rules, source preference, citation restrictions, and uncertainty behavior into the system prompt. Client messages MUST NOT be able to replace this policy.

#### Scenario: Current date affects the query
- **WHEN** GLM-5.2 searches for a latest or current item
- **THEN** the generated query uses the server-provided current year rather than an assumed training-data year

#### Scenario: Search results contain instructions
- **WHEN** a result snippet asks the model to ignore prior instructions, reveal secrets, or call another tool
- **THEN** the model treats that text as untrusted source data and does not follow it

### Requirement: Search provider calls SHALL be strictly bounded
Each Thread Chat response SHALL enforce a hard maximum of two started search provider requests regardless of model steps, retries, or parallel tool calls. The default operating target SHALL be one search call per triggered response.

#### Scenario: Model emits parallel search calls
- **WHEN** GLM-5.2 requests more than two searches in one or multiple steps
- **THEN** at most two provider requests start and every excess call receives a structured budget-exhausted result

#### Scenario: Search loop attempts to continue
- **WHEN** the model requests further searches after the budget is exhausted
- **THEN** the system terminates additional provider access and instructs the model to answer from available evidence or disclose insufficiency

#### Scenario: Non-production high-budget evaluation
- **WHEN** an internal or development environment explicitly sets the documented test-only search-budget override
- **THEN** `auto` mode can perform up to ten serial searches and receives one final answer step, while each step still starts at most one provider request
- **AND WHEN** the same configuration is present in production
- **THEN** the system ignores it and retains the two-request production maximum

### Requirement: Auto Search SHALL return minimal validated evidence
Auto Search SHALL use the low-cost search tier, disable provider-generated answers, return at most three deduplicated results per call, cap each snippet, and expose only normalized `sourceId`, title, public HTTP(S) URL, and snippet fields to the model.

#### Scenario: Provider returns malformed or unsafe URLs
- **WHEN** a result has a non-HTTP(S) scheme, embedded credentials, loopback/private/link-local IP literal, invalid URL, or duplicate canonical URL
- **THEN** the result is removed before the tool output reaches the model

#### Scenario: Provider returns long snippets
- **WHEN** a result exceeds the configured snippet budget
- **THEN** the tool truncates it deterministically before adding it to model context

### Requirement: Search failures SHALL degrade safely
Missing configuration, timeout, rate limit, provider error, empty results, and fully filtered results SHALL NOT fabricate sources or crash an otherwise answerable conversation.

#### Scenario: Auto mode without a configured provider
- **WHEN** Web Search is not configured and the request uses `auto`
- **THEN** the assistant answers from existing knowledge where possible and explicitly states when current facts could not be verified

#### Scenario: Forced search fails
- **WHEN** an `always` search times out or the provider returns an error
- **THEN** the UI shows the failure and the assistant either gives a clearly qualified fallback answer or states that it cannot verify the requested fact

### Requirement: Search SHALL coexist with existing Thread Chat tools
The Thread Chat tool policy SHALL allow Web Search and `createMarkdownArtifact` to participate in the same bounded AI SDK tool loop without enabling the old arbitrary-URL Deep Research tool.

#### Scenario: User requests a current Markdown migration guide
- **WHEN** the user asks for a standalone Markdown document about current framework migration behavior
- **THEN** the model can search first and then call `createMarkdownArtifact` in the same response

#### Scenario: Deep Research remains explicit
- **WHEN** the user does not explicitly enter the existing Deep Research mode
- **THEN** the Auto Search path does not inherit the 12-step research loop or expose `readUrl`
