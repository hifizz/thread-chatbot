## Purpose

为聊天与深度研究提供稳定、可审计且可扩展的公网搜索和网页读取能力，在不改变模型工具与前端事件契约的前提下，以 AnySearch 作为默认层并支持受控的多 provider 路由、故障恢复、额度治理和质量验收。

## ADDED Requirements

### Requirement: Provider-neutral Search and Fetch contract

The system SHALL expose Web access to the model through the semantic operations `webSearch` and `readUrl`, and SHALL keep provider credentials, provider-specific modes, billing parameters, and routing controls server-owned.

`webSearch` SHALL return a normalized query and result list containing at least title, URL, and snippet. `readUrl` SHALL return a normalized URL and bounded textual page content suitable for the model. Adding or changing a provider MUST NOT require a provider-specific model tool or a provider-specific frontend event.

#### Scenario: Model performs a Web search

- **WHEN** the selected execution mode permits Search and the model calls `webSearch`
- **THEN** the system selects an eligible Search provider on the server and returns normalized results without exposing provider credentials or provider-specific request fields to the model

#### Scenario: Model reads a source URL

- **WHEN** the selected execution mode permits Fetch and the model calls `readUrl` with a valid URL
- **THEN** the system selects an eligible Fetch provider and returns bounded normalized textual content through the existing `readUrl` result contract

#### Scenario: Provider implementation changes

- **WHEN** an operator changes the configured provider set or routing policy
- **THEN** existing model tool schemas, Web research UI events, and persisted historical messages remain compatible

### Requirement: AnySearch is the default Web access layer

The system SHALL use AnySearch Search and AnySearch Extract as the default providers for ordinary Search and Fetch requests while they are enabled, healthy, and within their configured capacity. The system SHALL support AnySearch anonymous access when no API key is configured and SHALL use the configured server-side API key when present.

#### Scenario: No optional provider is configured

- **WHEN** a Search or Fetch request requires Web access and no optional provider is eligible
- **THEN** the system uses the corresponding AnySearch operation and preserves the currently verified Search and Markdown extraction behavior

#### Scenario: AnySearch API key is configured

- **WHEN** `ANYSEARCH_API_KEY` is present in the server environment
- **THEN** the system authenticates AnySearch calls with that key without exposing it to the client, model, logs, or persisted messages

#### Scenario: AnySearch API key is absent

- **WHEN** `ANYSEARCH_API_KEY` is absent and anonymous access has not been explicitly disabled
- **THEN** the system keeps Web access available through AnySearch anonymous capacity instead of disabling the tools solely because a key is missing

### Requirement: Only configured and eligible providers can be selected

The system MUST construct Search and Fetch candidate sets from providers that are enabled, correctly configured for the requested operation, not open-circuited, and not known to have exhausted their local capacity budget. Optional providers without required credentials MUST be ignored rather than represented as usable fallbacks.

#### Scenario: Optional provider has no credentials

- **WHEN** a routing policy names an optional provider whose required server credentials are absent
- **THEN** the system excludes that provider from the candidate set and continues with another eligible provider

#### Scenario: Provider supports only one operation

- **WHEN** a configured provider supports Search but not Fetch, or Fetch but not Search
- **THEN** the system considers it only for the supported operation

#### Scenario: No provider is eligible

- **WHEN** all providers for the requested operation are disabled, misconfigured, open-circuited, or over budget
- **THEN** the tool returns a bounded, user-safe failure that allows the chat orchestration to explain the unavailable coverage without exposing secrets or raw provider errors

### Requirement: Routing policy is server-owned and intent-aware

The system SHALL select providers using server-owned policy that can consider operation type, execution mode, query domain, quality tier, latency target, budget, health, and available capacity. Ordinary generic traffic SHALL prefer AnySearch. Specialized or high-quality providers SHALL be selected only by an explicit policy rule and only when configured.

The client and model MUST NOT be allowed to name an arbitrary provider, submit provider credentials, or override provider billing and rate-limit settings.

#### Scenario: Ordinary Search request

- **WHEN** a generic `search` request has no specialized routing signal
- **THEN** the policy selects AnySearch while it is eligible

#### Scenario: Complex research request

- **WHEN** a `research` request matches a configured high-quality policy and Parallel or Exa is eligible
- **THEN** the policy may select the configured high-quality provider without changing the `webSearch` tool contract

#### Scenario: Vertical-domain request

- **WHEN** a query is classified into a configured vertical such as finance, academic, medical, patent, or SEC research and the vertical provider is eligible
- **THEN** the policy may select that provider and records the policy reason in server-side telemetry

#### Scenario: Client attempts provider override

- **WHEN** a client request or model-generated tool input includes an unsupported provider name, key, mode, or billing parameter
- **THEN** the system ignores or rejects the override and applies the server-owned policy

### Requirement: Fallback is bounded and operation-specific

The system SHALL support ordered, operation-specific fallback for transient provider failures, capacity exhaustion, and unusable empty responses. Fallback attempts MUST obey per-tool time, attempt, and cost budgets and MUST NOT form unbounded retry loops.

Search fallback SHALL prioritize one configured high-quality provider such as Parallel Basic or Exa Auto before broader optional providers. Fetch fallback SHALL use Firecrawl only when it is configured and AnySearch Extract fails, returns unusable content, or the policy identifies a supported dynamic-page case.

#### Scenario: Default Search provider has a transient failure

- **WHEN** AnySearch Search returns a configured transient error such as timeout, 429, or 5xx and an eligible Search fallback exists
- **THEN** the system records the failed attempt and tries the next provider within the Search attempt and time budget

#### Scenario: Default Fetch provider cannot produce usable content

- **WHEN** AnySearch Extract fails or returns content below the configured usability threshold and Firecrawl is eligible
- **THEN** the system attempts Firecrawl within the Fetch budget and returns the first usable normalized result

#### Scenario: Failure is non-retryable

- **WHEN** the request has an invalid URL, unsupported protocol, policy violation, or another non-retryable input error
- **THEN** the system stops without charging additional provider attempts and returns a bounded safe error

#### Scenario: Fallback budget is exhausted

- **WHEN** the maximum attempts, deadline, or cost budget is reached before a usable result is produced
- **THEN** the system stops further provider calls and returns the best safe partial outcome or a bounded unavailable result

### Requirement: Provider capacity and cost units are governed independently

The system SHALL maintain provider-specific capacity and usage accounting that distinguishes request, credit, page, retrieval, and task-run units. Rate limiting, daily or monthly quotas, concurrency, and local retry budgets MUST be evaluated per provider and per operation.

The system MUST NOT implement account rotation, key rotation, or automatic account creation for the purpose of bypassing a provider's account-level quota or rate limit.

#### Scenario: Provider reaches its local quota threshold

- **WHEN** the local usage ledger determines that a provider has reached the configured daily, monthly, concurrency, or cost threshold
- **THEN** the router excludes it from new attempts until the relevant budget resets or an operator changes the policy

#### Scenario: Providers use different billing units

- **WHEN** Search, Fetch, or research providers report different usage units
- **THEN** the system records the original unit and amount without falsely presenting all usage as equivalent requests

#### Scenario: Multiple keys belong to one service account

- **WHEN** more than one key is supplied for the same provider account
- **THEN** the system does not treat those keys as independent quota pools or rotate them to evade provider limits

### Requirement: Duplicate work is minimized without corrupting freshness

The system SHALL normalize queries and URLs for bounded deduplication and caching. Cache and deduplication policy MUST preserve explicit freshness requirements, provider-specific result semantics, and the distinction between Search and Fetch.

#### Scenario: Identical Search repeats within cache policy

- **WHEN** an equivalent Search request repeats within its configured freshness window and the cached result remains eligible
- **THEN** the system may return the normalized cached result without consuming another provider request

#### Scenario: Research plan repeats a query

- **WHEN** a research execution proposes a query already completed with no material parameter or freshness difference
- **THEN** the system reuses the existing evidence or suppresses the duplicate provider call

#### Scenario: User explicitly requires fresh data

- **WHEN** a request requires current or newly published information beyond the cache freshness boundary
- **THEN** the system bypasses stale cached results and performs a provider call within budget

### Requirement: Provider selection is observable without leaking sensitive input

The system SHALL make the actual selected provider and operation observable on the server. In development mode, each provider attempt SHALL emit a concise log containing at least provider and operation. Production telemetry SHALL support provider, operation, route reason, outcome, latency, retry or fallback count, usage unit, and sanitized error category.

Logs and telemetry MUST NOT contain API keys, authorization headers, full webpage content, model chain-of-thought, or full sensitive queries and URLs by default.

#### Scenario: Development Search call

- **WHEN** a Search provider attempt starts in development mode
- **THEN** the server log identifies the actual provider and `search` operation

#### Scenario: Development Fetch call

- **WHEN** a Fetch provider attempt starts in development mode
- **THEN** the server log identifies the actual provider and `extract` or `fetch` operation

#### Scenario: Production provider failure

- **WHEN** a provider fails in production
- **THEN** structured telemetry records a sanitized provider error category and routing outcome without logging credentials, full input, raw response bodies, or page content

### Requirement: Web content and URLs are treated as untrusted input

The system MUST accept only supported `http` and `https` URLs for remote Fetch, SHALL apply bounded redirect, content type, response size, and timeout policies, and SHALL present extracted Web content to the model as untrusted evidence that cannot override system or developer instructions.

#### Scenario: Unsupported URL protocol

- **WHEN** `readUrl` receives a URL using a protocol other than `http` or `https`
- **THEN** the system rejects it before calling a provider

#### Scenario: Extracted page contains instructions

- **WHEN** fetched Web content contains text that attempts to alter tool policy, reveal secrets, or override higher-priority instructions
- **THEN** the content remains evidence only and does not change provider routing, credential handling, or system behavior

#### Scenario: Response exceeds safety limits

- **WHEN** a redirect chain, content type, page size, or provider response exceeds a configured safety limit
- **THEN** the system stops processing that response and applies the bounded fallback or failure policy

### Requirement: Existing Web research orchestration remains compatible

The provider layer SHALL preserve the externally consumed behavior of `answer / fetch / search / research` routing, Research Planner execution, first-step tool forcing, Web research activity aggregation, source links, and message persistence. Provider routing details MUST remain server-side and MUST NOT create provider-specific historical message formats.

#### Scenario: Direct URL request

- **WHEN** the existing request router selects `fetch`
- **THEN** the chat orchestration still exposes only `readUrl`, forces the initial Fetch behavior, and receives a normalized provider result

#### Scenario: Deep research request

- **WHEN** the request router selects `research`
- **THEN** the existing Planner and multi-step executor continue to use `webSearch` and `readUrl` while provider selection occurs beneath those tools

#### Scenario: Persisted message is reloaded

- **WHEN** a historical message containing completed Web research activity is loaded after provider routing is introduced
- **THEN** the existing activity timeline and sources render without migration to a provider-specific schema

### Requirement: Provider rollout is validated against project workloads

The system SHALL maintain a project-owned evaluation set covering `answer`, `fetch`, `search`, and `research` behavior. A new provider or routing rule MUST be evaluated on routing correctness, answer and citation correctness, p50 and p95 latency, provider error and empty-result rates, tool-call counts, and total task cost before becoming a default production path.

Third-party benchmarks and vendor claims SHALL inform candidate selection but MUST NOT by themselves authorize a production-default routing change.

#### Scenario: New provider is introduced

- **WHEN** an adapter for a new provider is implemented
- **THEN** it remains disabled or non-default until contract tests, fault tests, and the project evaluation set meet documented acceptance thresholds

#### Scenario: Default policy is changed

- **WHEN** an operator proposes replacing AnySearch or changing a default routing tier
- **THEN** the decision includes project-specific quality, latency, reliability, and total-cost evidence and a rollback path

#### Scenario: Third-party ranking changes

- **WHEN** an external benchmark publishes a new provider ranking
- **THEN** the system does not automatically change production routing without project-level validation
