## ADDED Requirements

### Requirement: Every search attempt SHALL create an auditable external-usage record
The system SHALL record each attempted search provider call separately from model token usage with user, conversation/response correlation, provider, operation, status, billable units, cost, user price, latency, accepted result count, timestamp, and a privacy-preserving query fingerprint.

#### Scenario: Successful Basic Search
- **WHEN** Tavily Basic Search returns successfully
- **THEN** one external-usage record contains one billable credit and its computed cost and user price

#### Scenario: Provider request fails
- **WHEN** a search request times out or returns an error
- **THEN** the failed attempt is recorded with zero user charge unless provider billing evidence says a credit was consumed

### Requirement: Search pricing SHALL preserve the configured margin
Search provider cost SHALL be converted through the same integer micro-yuan, exchange-rate, and `priceFromCost` rules as model usage. The MVP SHALL conservatively value Tavily credits at the PAYG ceiling even when free or discounted credits are available.

#### Scenario: Free credits are available
- **WHEN** a search is covered by a provider free allowance
- **THEN** the system still records its shadow cost and billable unit instead of treating search as unmetered

#### Scenario: Search and model usage complete
- **WHEN** a searched response finishes successfully
- **THEN** the user-visible usage summary includes both model usage price and search price without counting either twice

### Requirement: Search cost exposure SHALL remain bounded per response
The charging and budget system SHALL ensure that no response incurs more than two Search units and SHALL expose per-response call count and price to monitoring.

#### Scenario: Concurrent calls race for the budget
- **WHEN** multiple tool executions begin concurrently for one response
- **THEN** the shared request budget admits at most two calls and metering matches the number actually started

### Requirement: GLM-5.2 SHALL pass a documented launch evaluation
Before enabling Auto Search for general users, the release SHALL record results for at least 60 bilingual routing cases and 20 live version-sensitive programming cases, including decision precision/recall, source validity, answer quality, latency, calls, and cost.

#### Scenario: Evaluation meets launch gates
- **WHEN** must-search recall and no-search precision are each at least 90%, source validity is 100%, no call exceeds the cap, and live answers show no quality regression
- **THEN** the feature can proceed from internal use to percentage-based rollout

#### Scenario: Evaluation misses a gate
- **WHEN** any launch threshold is missed
- **THEN** Auto Search remains behind the internal flag while prompt, tool description, or budget behavior is revised and re-evaluated
