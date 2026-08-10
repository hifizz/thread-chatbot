## ADDED Requirements

### Requirement: Retrieval observability SHALL cover quality, reliability, latency, and cost
Production telemetry SHALL expose search trigger rate, calls per response, zero-result rate, primary-source ratio, citation quality samples, p50/p95 latency, provider errors, retries/fallbacks, circuit state, cache hit rate, external cost, user price, and feedback.

#### Scenario: Provider becomes expensive without failing
- **WHEN** success rate stays stable but cost per grounded answer rises beyond its threshold
- **THEN** monitoring raises a cost regression signal even though availability remains healthy

#### Scenario: Search succeeds with poor sources
- **WHEN** calls return results but primary-source or citation-support metrics decline
- **THEN** quality monitoring detects the regression separately from provider success rate

### Requirement: Evaluation runs SHALL be reproducible
Each GLM-5.2 evaluation SHALL record dataset version, model/upstream identifier, prompt hash, tool schema version, provider adapter/version, retrieval parameters, budgets, timestamp, and metric results.

#### Scenario: Prompt policy changes
- **WHEN** the search decision prompt is modified
- **THEN** the routing and live programming suites rerun with a new recorded prompt hash before rollout

#### Scenario: Provider ranking changes
- **WHEN** search parameters or provider adapter version changes
- **THEN** source relevance, citation, latency, and cost evaluations rerun on the same dataset version

### Requirement: Release gates SHALL prevent unsafe or uneconomic regressions
A retrieval-related release SHALL have zero hard-cap and unsafe-target regressions, SHALL not materially reduce citation/answer quality, and SHALL remain within the explicitly recorded latency and cost budgets before general rollout.

#### Scenario: Hard-cap regression appears
- **WHEN** a fault or concurrency test starts more provider calls than allowed
- **THEN** the release is blocked regardless of answer quality improvements

#### Scenario: Candidate passes all gates
- **WHEN** safety, quality, latency, reliability, and cost gates pass
- **THEN** the candidate can progress through percentage rollout with an immediate rollback control

### Requirement: Experiments SHALL expose and attribute incremental cost
Shadow, A/B, and dual-provider evaluation traffic SHALL tag incremental provider cost as experiment spend and SHALL not silently charge users for calls that were unnecessary to produce their answer.

#### Scenario: Shadow provider runs
- **WHEN** a production query is copied to a candidate provider for evaluation
- **THEN** its cost is recorded to the experiment and excluded from the user's answer charge unless the user was explicitly informed and opted into that pricing
