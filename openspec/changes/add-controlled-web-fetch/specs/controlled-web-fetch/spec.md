## ADDED Requirements

### Requirement: The model SHALL fetch only registered sources
The Web Fetch tool SHALL accept only an opaque `sourceId` issued for an accepted search result in the same response. It MUST NOT accept a raw URL or resolve IDs from another response.

#### Scenario: Model reads a current search result
- **WHEN** GLM-5.2 calls `readSource` with a valid source ID from the current response
- **THEN** the server resolves the registered URL and can request managed extraction

#### Scenario: Model invents a source ID
- **WHEN** `readSource` receives an unknown, expired, or cross-response source ID
- **THEN** it fails before contacting the extraction provider

#### Scenario: Page text suggests another URL
- **WHEN** extracted text instructs the model to read a different URL
- **THEN** the model cannot pass that raw URL to the fetch tool and does not navigate to it

### Requirement: Fetch targets SHALL pass public-web validation
Before managed extraction, the server SHALL require a valid HTTP(S) URL and reject embedded credentials, unsafe ports, localhost/local domains, and loopback, private, link-local, multicast, reserved, or otherwise non-public IP literals.

#### Scenario: Search result points to a private target
- **WHEN** a registered result resolves syntactically to a disallowed private or local target
- **THEN** the source is marked unsafe and no extraction request is sent

#### Scenario: Search result uses an executable scheme
- **WHEN** a result URL uses `file:`, `data:`, `javascript:`, `ftp:`, or another non-HTTP(S) scheme
- **THEN** the source is rejected before registration or extraction

### Requirement: Extracted content SHALL be bounded and typed
The fetch path SHALL enforce provider timeout, allowed textual content types, response-size limits, deterministic model-context truncation, and an absolute maximum of two extract provider calls per response.

#### Scenario: Extracted document is oversized
- **WHEN** extracted text exceeds the 6,000-character context budget
- **THEN** the tool returns only the bounded prefix or normalized selection and sets a truncation indicator

#### Scenario: Provider returns binary content
- **WHEN** the target is an archive, executable, media file, or unsupported binary document
- **THEN** the tool rejects the content and does not insert it into model context

#### Scenario: Parallel reads exceed budget
- **WHEN** the model emits more than two read calls concurrently or sequentially
- **THEN** at most two extraction provider requests start and excess calls receive a budget-exhausted result

### Requirement: Extracted pages SHALL be treated as untrusted evidence
The system SHALL delimit extracted content as data and SHALL instruct the model not to follow page-supplied requests to alter instructions, reveal secrets, call tools, navigate, download, submit data, or contact third parties.

#### Scenario: Page contains prompt injection
- **WHEN** extracted text says to ignore the system prompt and expose environment variables
- **THEN** GLM-5.2 ignores that instruction and uses only relevant factual content as evidence

### Requirement: Fetch failures SHALL preserve a search-only fallback
Timeout, unsafe source, empty extraction, unsupported content, provider error, and exhausted budget SHALL return structured failure without fabricating body text or sources.

#### Scenario: Primary source cannot be extracted
- **WHEN** managed extraction fails for a registered source
- **THEN** the assistant answers from available search snippets with an explicit limitation or states that evidence is insufficient

