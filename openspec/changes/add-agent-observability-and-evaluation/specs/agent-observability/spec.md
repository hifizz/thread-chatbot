## Purpose

为 Agent 的本地开发、线上运行和问题复盘提供统一且可关联的可观测性契约，使一次生成中的路由、模型、工具、搜索、持久化、反馈和失败能够被安全追踪，并允许在不改变业务权威数据的前提下替换观测后端。

## ADDED Requirements

### Requirement: Observability behavior is environment-specific

The system SHALL provide a local inspection backend in development and a remote observability backend in configured staging or production environments. Local inspection data MUST remain on the developer machine, MUST be excluded from version control, and MUST NOT be enabled in production. Remote export credentials MUST remain server-side.

#### Scenario: Developer runs the Agent locally

- **WHEN** the application runs in development with local inspection enabled
- **THEN** the developer can inspect model steps, tool executions, timing, usage, outputs, and errors for new Agent runs without sending those local inspection records to the production observability project

#### Scenario: Production application starts

- **WHEN** the application runs in production
- **THEN** the local inspection backend is not initialized and no local inspection endpoint or data file is exposed

#### Scenario: Remote credentials are absent

- **WHEN** the remote observability backend is not configured for an environment
- **THEN** the application starts without remote export and continues to serve Agent requests with a concise server-side diagnostic log

### Requirement: Each assistant attempt has a stable trace identity

The system SHALL represent each assistant Message as one Agent generation attempt and one root Trace. The Trace identity MUST be deterministically derived from the existing assistant Message ID, MUST group the conversation by existing Project identity, and MUST include Thread identity as searchable metadata. The observability system MUST NOT create a second generation business entity or become an authority for conversation state.

#### Scenario: A new assistant attempt starts

- **WHEN** a committed assistant Message begins background generation
- **THEN** exactly one root Trace is associated with that Message ID and contains its Project ID, Thread ID, model identity, environment, and release identity

#### Scenario: A retry creates a new assistant Message

- **WHEN** the user retries or regenerates and the conversation system creates a new assistant Message
- **THEN** the new Message receives a new Trace while the replaced Message and its Trace remain independently inspectable

#### Scenario: An idempotent command is replayed

- **WHEN** the same accepted command resolves to the same assistant Message ID more than once
- **THEN** all telemetry uses the same deterministic Trace identity instead of creating duplicate logical Agent attempts

### Requirement: A trace covers the complete server-owned generation lifecycle

The root Trace SHALL cover the server-owned Agent run from generation start through its terminal `completed`, `stopped`, or `failed` outcome. Client stream detachment MUST NOT close or mark the Trace successful while the background run continues. The Trace outcome MUST agree with the terminal Message state when finalization succeeds.

#### Scenario: Browser stream disconnects during generation

- **WHEN** the HTTP or SSE consumer disconnects but the server-owned generation continues
- **THEN** the root Trace remains active until the background run reaches and persists a terminal outcome

#### Scenario: User stops generation

- **WHEN** an authorized Stop command aborts an active generation
- **THEN** the Trace records a stopped or aborted outcome and remains associated with the stopped assistant Message

#### Scenario: Process restart leaves a generation unfinished

- **WHEN** restart recovery converts an abandoned generating Message to `failed`
- **THEN** observability records or reconciles a failure outcome using the same Message-derived Trace identity without presenting it as a completed response

### Requirement: Agent steps are correlated as structured observations

The system SHALL record structured child Observations for applicable research routing, research planning, language-model calls, tool executions, Search/Fetch provider attempts, persistence checkpoints, and finalization. Each Observation SHALL expose a stable purpose or operation name, start and end timing, outcome, and sanitized error category when it fails. Model Observations SHALL include available provider usage and finish reason. Provider-attempt Observations SHALL include provider, operation, route reason, attempt index, fallback count, duration, outcome, and original usage unit when available.

#### Scenario: Research request uses tools

- **WHEN** an Agent run performs route selection, planning, Web Search, URL reading, and a final model response
- **THEN** those steps appear under the same root Trace in execution order and can be filtered by purpose, tool, provider, outcome, and duration

#### Scenario: Search fallback occurs

- **WHEN** one Search provider attempt fails and a bounded fallback attempt runs
- **THEN** both attempts are represented as distinct correlated Observations with their own provider, outcome, duration, and sanitized error category

#### Scenario: Model usage is available

- **WHEN** a model provider returns token or provider usage and a finish reason
- **THEN** the corresponding model Observation records the original usage fields and finish reason without interpreting them as product billing

### Requirement: Production telemetry is private by default

Production telemetry SHALL record structure, identities needed for correlation, timing, usage, tool and provider names, outcomes, and sanitized metadata by default. Recording prompt inputs, model outputs, attachment contents, fetched page bodies, or other user content MUST be disabled by default and MAY be enabled only for an explicitly configured staging, evaluation, or controlled sampling policy after masking. API keys, authorization headers, cookies, raw provider payloads, complete sensitive queries or URLs, and hidden chain-of-thought MUST never be exported.

#### Scenario: Ordinary production generation

- **WHEN** a production Agent run is not part of an approved content-recording cohort
- **THEN** its Trace is operationally useful without exporting prompt text, response text, attachment contents, or fetched page bodies

#### Scenario: Evaluation environment records content

- **WHEN** an authorized evaluation run enables input and output recording
- **THEN** configured masking runs before export and removes credentials, personal data, sensitive URL components, and prohibited internal reasoning

#### Scenario: Provider returns a verbose failure

- **WHEN** an upstream error contains request bodies, credentials, page content, or provider-specific raw details
- **THEN** telemetry contains only the approved error category and safe summary

### Requirement: Observability failures cannot break Agent behavior

Telemetry initialization, export, batching, flushing, and remote backend failures MUST NOT change authorization, conversation persistence, streaming, tool execution, terminal Message state, or the response returned to the user. A bounded local diagnostic signal SHALL remain available when remote export fails.

#### Scenario: Remote backend is unavailable

- **WHEN** the observability backend times out or rejects a batch during generation
- **THEN** the Agent run and its database finalization continue and the server emits a bounded diagnostic event without logging prohibited content

#### Scenario: Telemetry callback throws

- **WHEN** an observability integration raises an unexpected error
- **THEN** the application contains the error at the telemetry boundary and does not turn an otherwise successful Agent run into a failed Message

### Requirement: Product feedback is mirrored as an idempotent score

The product database SHALL remain the authority for assistant feedback. The same transaction SHALL persist the current `up`, `down`, or cleared state and a monotonically versioned Score outbox record. After commit, workers SHALL mirror the latest version to the deterministic Trace as an idempotent score. A mirror failure MUST NOT roll back or reject product feedback, and the system SHALL support persistent retrying or backfilling unsynchronized feedback without creating duplicate logical scores. Multiple workers MUST NOT acknowledge a newer feedback version using an older delivery result.

#### Scenario: User submits positive feedback

- **WHEN** the product database commits `up` feedback for an assistant Message
- **THEN** the user receives success independently of Langfuse availability and an idempotent positive score is attempted against the Message-derived Trace

#### Scenario: User changes or clears feedback

- **WHEN** the authoritative feedback value changes from its previous state
- **THEN** the same logical score identity is updated or replaced so remote analysis reflects the current product value rather than accumulating contradictory scores

#### Scenario: Initial mirror fails

- **WHEN** the product feedback commits but remote score export fails
- **THEN** a later retry or backfill can derive the same Trace and score identities from product data and converge without changing the Message

#### Scenario: Feedback changes while an older delivery is running

- **WHEN** a worker has claimed one feedback version and the user changes or clears the authoritative feedback before its remote call completes
- **THEN** the older worker cannot acknowledge the newer version, and a later drain mirrors the latest state to the same logical Score

#### Scenario: Worker or instance terminates before delivery

- **WHEN** a process exits after the feedback transaction commits but before Langfuse confirms the Score
- **THEN** another instance or operator drain can reclaim the durable outbox item after its lease and retry it without changing product feedback

### Requirement: Cloud usage and backend portability are operationally visible

The first production rollout SHALL use a dedicated Langfuse Cloud project and SHALL expose enough operational information to detect approaching plan usage, history, user, or throughput limits before they impair diagnosis. Backend endpoint and credentials MUST be environment configuration so the application can move to another Langfuse region, paid plan, or compatible self-hosted deployment without changing Agent orchestration or persisted Message formats.

#### Scenario: Hobby allocation approaches its limit

- **WHEN** the deployed project approaches an included usage, retention, user, or throughput boundary
- **THEN** the operator can identify the boundary and choose sampling, reduced content capture, plan upgrade, export, or self-hosting before relying on unavailable history

#### Scenario: Observability backend changes

- **WHEN** the operator switches from Langfuse Cloud to a compatible self-hosted endpoint
- **THEN** only environment and deployment configuration change while Trace identity, Agent orchestration, feedback authority, and conversation schema remain compatible

### Requirement: Legacy and normalized Agent entry points remain observable during transition

The system SHALL capture model and tool Observations from every active Agent entry point during the transition to normalized Thread Chat. The normalized server-owned lifecycle SHALL receive full root-Trace coverage; a legacy streaming entry point MAY initially provide request-scoped root coverage, but it MUST still emit correlated model, tool, usage, outcome, and sanitized error Observations until it is retired.

#### Scenario: Normalized Thread Chat is used

- **WHEN** a generation runs through the normalized conversation service
- **THEN** observability follows the assistant Message through background execution and terminal persistence

#### Scenario: Legacy chat route remains active

- **WHEN** a request uses an active legacy chat route
- **THEN** its model and tool activity remains observable and distinguishable from normalized Thread Chat rather than disappearing from production traces
