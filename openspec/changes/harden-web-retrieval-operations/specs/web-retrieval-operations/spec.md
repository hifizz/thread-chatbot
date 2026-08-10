## ADDED Requirements

### Requirement: Retrieval providers SHALL implement explicit normalized adapters
Each search or extraction provider SHALL isolate vendor request/response formats behind a server-only adapter and return common source, error, timing, and billing metadata to the model tool layer.

#### Scenario: Provider response format changes
- **WHEN** one vendor changes a response field
- **THEN** only that adapter and its fixtures require changes while the model tool and UI contracts remain stable

#### Scenario: Provider lacks extraction
- **WHEN** a configured adapter does not advertise extract capability
- **THEN** the system does not route `readSource` to that adapter and returns a classified unsupported result or configured fallback

### Requirement: Provider selection SHALL be benchmark-driven and reversible
Before changing the primary provider, the system SHALL compare candidates on the same versioned programming dataset for relevance, primary-source rate, freshness, citation support, latency, errors, and normalized cost, and SHALL retain a tested rollback path.

#### Scenario: Marketplace candidate ranks first but underperforms
- **WHEN** the top discovered provider fails project quality or cost gates
- **THEN** it is not promoted solely because of Marketplace ordering

#### Scenario: New provider passes gates
- **WHEN** a candidate meets recorded gates in shadow or limited A/B traffic
- **THEN** it can be promoted by configuration without changing model tool schemas

### Requirement: Retry, fallback, and provider calls SHALL share one budget
All primary calls, retries, fallback calls, searches, and extracts in a response SHALL consume one deadline, request-unit, and maximum-price budget. The system MUST NOT fan out to multiple providers by default.

#### Scenario: Primary provider returns a retryable error
- **WHEN** one retry fits the remaining deadline and budget
- **THEN** the system can retry once and records both attempts

#### Scenario: Retry would exceed user price cap
- **WHEN** another attempt could exceed the response's declared external-cost cap
- **THEN** the system fails over to a qualified answer or stops retrieval without starting that attempt

### Requirement: Provider health SHALL control admission
The operations layer SHALL classify provider errors, maintain a rolling circuit state, and support immediate per-provider and global retrieval disable controls.

#### Scenario: Provider has sustained failures
- **WHEN** health thresholds open the circuit
- **THEN** normal requests stop contacting that provider until a controlled probe or operator action closes it

### Requirement: Retrieval cache SHALL be public-data-only and freshness-aware
The system SHALL cache only normalized public retrieval data using provider/version/options-aware keys, short TTLs, and in-flight request coalescing. Sensitive queries and private/user-specific content MUST bypass cache.

#### Scenario: Two users issue the same public docs query
- **WHEN** an unexpired normalized cache entry exists
- **THEN** the second response can reuse it without another provider call and metering marks a cache hit

#### Scenario: Query contains a secret token
- **WHEN** sensitivity checks identify credentials or private content
- **THEN** the request bypasses shared cache and the secret is not written to cache keys or values

### Requirement: Distributed quotas SHALL bound concurrent spend
The system SHALL enforce atomic per-user, per-conversation, time-window, and global retrieval limits across concurrent Function instances in addition to request-local hard caps.

#### Scenario: Concurrent requests approach a daily limit
- **WHEN** several requests reserve external cost at the same time
- **THEN** atomic admission prevents their combined reservation from exceeding the applicable limit

#### Scenario: Quota rejects a search
- **WHEN** the user or global retrieval allowance is exhausted
- **THEN** rejection occurs before provider access and is shown as a rate/cost limit rather than a fabricated provider failure

### Requirement: Retrieval data SHALL follow minimum-retention privacy rules
Default logs and metrics SHALL exclude full queries, page content, credentials, and provider secrets; retained identifiers SHALL be minimized, access-controlled, and deleted according to a documented schedule.

#### Scenario: Operator inspects a provider incident
- **WHEN** logs are queried for an incident
- **THEN** correlated status, timing, cost, and redacted fingerprints are available without exposing full user content by default

