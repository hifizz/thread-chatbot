## ADDED Requirements

### Requirement: Browser retrieval SHALL require a measured coverage gap
The browser capability SHALL remain disabled until documented evaluation or production data shows a recurring approved class of public pages that search and managed extraction cannot read because of JavaScript rendering or safe disclosure interaction.

#### Scenario: Search and extraction already answer the case
- **WHEN** the required evidence is available through bounded search snippets or `readSource`
- **THEN** the system does not start a browser task

#### Scenario: Measured JS-rendering gap is approved
- **WHEN** an approved source class repeatedly fails managed extraction but succeeds in the sandbox evaluation
- **THEN** that class can be enabled behind an independent cohort flag and kill switch

### Requirement: Browser execution SHALL be isolated from the chat application
Browser sessions SHALL run in a provisioned hosted browser service or an ephemeral sandbox and MUST NOT run with the main chat Function's filesystem, network authority, application environment, or secrets.

#### Scenario: Browser task starts
- **WHEN** the server admits a browser read
- **THEN** it creates a fresh ephemeral session containing only short-lived browser-provider credentials

#### Scenario: Session ends abnormally
- **WHEN** the task succeeds, fails, times out, or is cancelled
- **THEN** the session and its cookies, storage, cache, and temporary files are destroyed

### Requirement: The model SHALL receive only a high-level source read tool
The browser tool SHALL accept a current-response registered `sourceId` and an approved read goal. It MUST NOT accept arbitrary URLs, JavaScript, selectors, shell commands, credentials, or unrestricted action sequences.

#### Scenario: Model supplies a raw URL or script
- **WHEN** tool input attempts to include a new URL, JavaScript, or selector instructions
- **THEN** schema validation rejects the call before creating a browser session

#### Scenario: Valid rendered-text request
- **WHEN** the model requests `rendered_text` for an approved registered source
- **THEN** the orchestration runs the fixed read-only workflow for that source

### Requirement: Browser networking SHALL be deny-by-default
The sandbox SHALL allow only validated public HTTP(S) destinations needed for the approved source, SHALL revalidate DNS and redirects, and SHALL block localhost, metadata endpoints, private/link-local/reserved networks, non-HTTP(S) protocols, popups, unapproved cross-origin navigation, and downloads.

#### Scenario: Page redirects to a private IP
- **WHEN** navigation or a subrequest targets a private or reserved address
- **THEN** the network policy blocks it, records a security event, and terminates or safely continues according to policy

#### Scenario: Page triggers a download
- **WHEN** the page initiates a file download
- **THEN** the browser blocks the download and no file is made available to the model or application

### Requirement: Browser behavior SHALL be read-only
The browser workflow MUST NOT log in, fill or submit forms, accept permissions, upload files, make purchases, bypass access controls, or perform other external state changes. Optional UI expansion SHALL be restricted to approved non-mutating disclosure patterns.

#### Scenario: Page asks for login
- **WHEN** the target requires authentication or user cookies
- **THEN** the task stops and reports unsupported access without requesting credentials

#### Scenario: Disclosure widget is approved
- **WHEN** public documentation text is hidden behind a recognized non-mutating expand control
- **THEN** the fixed workflow can expand it within action and time limits, then only extracts visible text

### Requirement: Browser resources and output SHALL be bounded
The first browser release SHALL allow at most one task per response and SHALL enforce hard time, navigation, request, byte, memory/CPU where available, DOM/text, and output limits. Only sanitized bounded evidence and safe metadata SHALL reach GLM-5.2.

#### Scenario: Page creates infinite activity
- **WHEN** the page continuously navigates, allocates resources, or streams content
- **THEN** the first exceeded limit terminates the task and returns a structured bounded failure

#### Scenario: Page contains hidden instructions and scripts
- **WHEN** extraction completes
- **THEN** scripts, controls, event handlers, hidden content, storage data, and traces are removed while visible text remains labeled untrusted evidence

### Requirement: Browser cost and security events SHALL be separately auditable
Every admitted browser task SHALL record user/response correlation, provider, runtime/network units, cost, user price, latency, termination reason, navigation count, blocked requests, and extracted size. Admission SHALL check browser-specific user/global allowance and maximum price before session creation.

#### Scenario: Browser allowance is exhausted
- **WHEN** a request has no remaining browser allowance
- **THEN** the server rejects it before session creation and falls back to search/extract evidence

#### Scenario: Private-target attempts spike
- **WHEN** blocked private or metadata destination events cross an alert threshold
- **THEN** monitoring alerts operators and the independent kill switch can stop new browser admission without disabling ordinary search

### Requirement: Browser retrieval SHALL pass adversarial release tests
Before any external rollout, the feature SHALL pass tests for malicious redirects, DNS/private targets, cross-origin navigation, downloads, form submission, prompt injection, resource exhaustion, cancellation, cleanup, billing, and emergency disable behavior.

#### Scenario: Any isolation test fails
- **WHEN** a test demonstrates access outside the approved network/action/resource boundary
- **THEN** browser retrieval remains disabled regardless of answer-quality benefit
