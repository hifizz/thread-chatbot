## Purpose

为 Agent 的 prompt、模型、Search 工具、记忆上下文、多模态处理和可靠性变更建立项目自有、可重复且可逐步扩展的评测契约，使生产问题能够进入数据集并在候选版本上线前形成可解释的回归证据。

## ADDED Requirements

### Requirement: Evaluation cases are project-owned and versionable

The system SHALL maintain a project-owned, reviewable source of evaluation cases that can be synchronized to the experiment backend without making the hosted copy the sole authority. Each case SHALL have a stable ID, suite, input fixture, expected behavior or rubric, sensitivity classification, and tags needed to select subsets. Changes to cases and expectations MUST be attributable to a repository revision or explicit dataset revision.

#### Scenario: Evaluator checks out an older release
- **WHEN** an evaluator runs the repository at a known revision
- **THEN** the corresponding evaluation cases and expectations can be identified without depending only on the latest mutable hosted dataset

#### Scenario: Hosted dataset is recreated
- **WHEN** the remote experiment project is empty or replaced
- **THEN** authorized project-owned cases can be synchronized without changing their stable case identities

### Requirement: Evaluation suites cover the Agent's principal behaviors

The project SHALL provide tagged suites for core answers, Search and research routing, memory and branch context, multimodal inputs, and operational reliability. Initial coverage MUST include non-Web answers, Fetch/Search/Research selection, citations and fallback, same-thread recall, frozen branch context, cross-Project isolation, image or document attachments, stop/retry/disconnect, provider timeout or rate limit, empty results, and terminal-state correctness.

#### Scenario: Search behavior changes
- **WHEN** a prompt, provider, routing policy, Search tool, or fallback rule is a candidate for release
- **THEN** the Search suite can measure routing correctness, tool-call count, answer and citation quality, fallback behavior, latency, errors, empty results, usage, and estimated cost where available

#### Scenario: Memory behavior changes
- **WHEN** context compilation, retrieval, embedding, top-k, or branch handling changes
- **THEN** the memory suite can detect missing expected facts, contradiction handling regressions, stale branch context, and cross-Project leakage

#### Scenario: Multimodal behavior changes
- **WHEN** attachment parsing, model capability, or multimodal prompting changes
- **THEN** the multimodal suite can exercise supported image/document fixtures, grounded answers, corrupted or unsupported inputs, and configured size boundaries

#### Scenario: Streaming lifecycle changes
- **WHEN** stop, retry, disconnect recovery, finalization, or provider-error handling changes
- **THEN** the reliability suite can validate user-visible and persisted terminal outcomes instead of scoring only final answer text

### Requirement: Experiments execute representative application logic

The evaluation runner SHALL execute the same server-owned routing, prompt construction, context compilation, model configuration, tool contracts, and result normalization used by the application wherever practical. A prompt-only playground result MUST NOT be treated as sufficient evidence for changes that affect tools, memory, multimodal processing, persistence, or lifecycle behavior.

#### Scenario: Prompt-only candidate is tested
- **WHEN** only prompt text or model parameters change and no orchestration behavior is in scope
- **THEN** a prompt-level experiment may provide early feedback but the project runner remains the release evidence for applicable end-to-end cases

#### Scenario: Search tool implementation changes
- **WHEN** a candidate changes provider routing or tool behavior
- **THEN** evaluation invokes the project Search orchestration and captures actual tool attempts rather than substituting a static mock as the only quality result

### Requirement: Every run records a comparable configuration fingerprint

Each evaluated output SHALL record the candidate label, dataset revision, model identity, prompt version, Search policy and provider configuration version, memory/context compiler version, toolset version, multimodal parser version, application release or commit, environment, and evaluator versions that materially affect its scores. Secret values MUST NOT be included in the fingerprint.

#### Scenario: Two candidate runs are compared
- **WHEN** baseline and candidate results differ
- **THEN** the experiment report exposes the material configuration differences needed to explain and reproduce the comparison

#### Scenario: Provider implementation is unchanged but policy changes
- **WHEN** only routing thresholds or fallback order change
- **THEN** the policy version changes in the fingerprint so results are not misattributed to the same configuration

### Requirement: Scoring remains decomposed and explainable

The system SHALL prioritize deterministic and programmatic scores for success, schema validity, expected route or tool, citation presence and support, memory facts, isolation, lifecycle state, latency, usage, fallback, error, and empty-result behavior. Model-based judges MAY add correctness, faithfulness, helpfulness, completeness, and citation-support scores, but judge identity and rubric version MUST be recorded. User feedback SHALL remain a separate signal. Release decisions MUST NOT depend only on one opaque aggregate score.

#### Scenario: Deterministic contract fails
- **WHEN** a candidate produces an invalid schema, wrong route, forbidden cross-Project fact, or incorrect terminal state
- **THEN** the relevant deterministic score fails regardless of a favorable model-judge opinion

#### Scenario: Model judge is used
- **WHEN** a subjective quality dimension is scored by a model
- **THEN** the result records judge model and rubric version and can be reviewed alongside deterministic scores and sampled human labels

#### Scenario: User dislikes a production answer
- **WHEN** negative product feedback is mirrored to the observability backend
- **THEN** it remains identifiable as user feedback and is not silently converted into a ground-truth correctness label

### Requirement: Baseline and candidate experiments are comparable

An experiment SHALL run baseline and candidate configurations against the same selected case IDs and SHALL report per-suite deltas, failures, p50 and p95 latency, available usage or estimated cost, and case-level evidence. Nondeterministic network or model failures MUST be identified separately from quality failures. Any configured release threshold SHALL be suite-specific and reviewable.

#### Scenario: Candidate improves quality but increases cost
- **WHEN** the candidate raises quality scores while also raising latency, tool calls, usage, or estimated cost
- **THEN** the experiment report exposes both effects instead of reporting only the quality improvement

#### Scenario: External provider is temporarily unavailable
- **WHEN** a case fails due to a classified provider outage or rate limit
- **THEN** the report distinguishes infrastructure reliability from an answer-quality regression while still counting the operational failure in the appropriate reliability metric

### Requirement: Production failures can become sanitized regression cases

The system SHALL support a controlled workflow that selects a production Trace, reviews and removes sensitive data, assigns expected behavior or a rubric, and adds the resulting case to a project-owned suite. Raw production prompts, outputs, attachments, fetched pages, user identifiers, or hidden reasoning MUST NOT be copied automatically into a committed dataset.

#### Scenario: Operator triages negative feedback
- **WHEN** an operator determines that a negatively rated Trace represents a reusable product failure
- **THEN** the operator can create a sanitized case with provenance to the issue category while excluding direct user identity and prohibited content

#### Scenario: Trace contains sensitive attachment data
- **WHEN** a production failure depends on a private document or image that cannot be safely retained
- **THEN** the regression case uses an approved synthetic or separately protected fixture, or remains excluded from the committed dataset

### Requirement: Evaluation rollout is progressive

The project SHALL support a fast local subset, a small continuous-integration subset, and a broader scheduled or release experiment. The initial implementation MAY begin with local and manually triggered experiments, but each automation stage MUST use the same case identities, fingerprints, and scoring contracts. Continuous-integration failure thresholds MUST be introduced only after a recorded baseline and SHALL provide an explicit override and rollback procedure for flaky external dependencies.

#### Scenario: Developer changes a prompt
- **WHEN** a developer requests a quick local evaluation
- **THEN** the fast subset returns case-level results and records the candidate fingerprint without requiring the full production-scale suite

#### Scenario: Pull request touches Agent behavior
- **WHEN** the CI gate is enabled after baseline calibration
- **THEN** the small stable subset can block a configured deterministic regression and links to the experiment evidence

#### Scenario: Broad suite contains volatile live-Web cases
- **WHEN** scheduled evaluation encounters expected Web volatility
- **THEN** volatile cases are tagged and judged with freshness-aware rules rather than weakening deterministic gates for stable cases

### Requirement: Evaluation telemetry is isolated and attributable

Evaluation runs SHALL be identifiable as evaluation traffic and SHALL NOT contaminate production user, session, feedback, or product analytics. The experiment backend SHALL correlate each case output, score, and Trace to its experiment run and candidate configuration. Evaluation credentials and fixtures MUST obey the same server-side secret and content-masking boundaries as production.

#### Scenario: Experiment invokes the real Agent
- **WHEN** an evaluation case runs through production-like orchestration
- **THEN** its Trace carries evaluation environment, experiment, case, and candidate identifiers and is excluded from ordinary production-session analysis

#### Scenario: Experiment writes scores
- **WHEN** deterministic or model-based evaluators finish
- **THEN** their scores attach to the corresponding experiment case and Trace without overwriting product user feedback

### Requirement: Search provider evaluation reuses the shared evaluation platform

Search provider adapters and routing policies SHALL use the same datasets, runner, Trace correlation, configuration fingerprints, result schema, and reporting pipeline as other Agent changes. Provider-specific contract and fault tests MAY remain specialized, but the project MUST NOT create a separate incompatible observability or experiment system for Search.

#### Scenario: New Search provider is proposed
- **WHEN** a provider adapter or default routing rule is evaluated
- **THEN** its project-level quality, latency, reliability, fallback, usage, and cost evidence is produced through the shared Agent evaluation platform

#### Scenario: Search observability tasks are implemented
- **WHEN** provider attempt events are added under the Web Search routing change
- **THEN** they conform to the shared Trace and privacy contract and remain usable by the Search evaluation suite
