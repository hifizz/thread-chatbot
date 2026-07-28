## ADDED Requirements

### Requirement: Ark Coding Plan model registry and routing

The system SHALL register the models listed by the Ark Coding Plan documentation in the shared chat model registry and SHALL route each Ark model through the Coding Plan OpenAI-compatible endpoint using the server-only `ARK_CODING_API_KEY`. The default endpoint SHALL include `/api/coding/v3`.

#### Scenario: GLM-5.2 request uses Ark Coding Plan

- **WHEN** `/api/chat` receives a valid request whose `modelId` is `glm-5.2`
- **THEN** the system SHALL stream the response from the Ark Coding Plan-compatible GLM-5.2 model through AI SDK 7

#### Scenario: Ark key is missing

- **WHEN** a valid Ark model is requested but `ARK_CODING_API_KEY` is not configured
- **THEN** the server SHALL reject the request with a clear configuration error before starting model generation

#### Scenario: Model options come from the registry

- **WHEN** the Thread Chat model selector is rendered
- **THEN** its Ark choices SHALL be derived from the shared chat model registry rather than a second UI-only list

### Requirement: Thread-owned model selection

Every Thread SHALL have a valid `modelId` that determines the model for its next chat request. A root Thread SHALL initialize with the application default model, and only a root Thread SHALL be allowed to change its `modelId` in the MVP.

#### Scenario: Main Thread changes model

- **WHEN** the user selects a different enabled model on the root Thread
- **THEN** the store SHALL persist the selected `modelId` on that Thread and the next request SHALL use it

#### Scenario: Switching does not rewrite history

- **WHEN** the root Thread changes models after messages already exist
- **THEN** existing messages SHALL remain unchanged and only subsequent requests SHALL use the new model

### Requirement: Branch model inheritance and lock

A newly forked Thread SHALL copy its parent Thread's current `modelId`. The model selector for every non-root Thread SHALL remain disabled in the MVP, including after reload.

#### Scenario: Branch inherits the main model

- **WHEN** the user forks a message while the parent Thread uses GLM-5.2
- **THEN** the new Thread SHALL be created with `modelId` equal to `glm-5.2`

#### Scenario: Branch selector is disabled

- **WHEN** a non-root Thread is displayed
- **THEN** its selector SHALL show the inherited model and SHALL not permit a model change

#### Scenario: Nested branch inherits its direct parent

- **WHEN** a branch is forked from another branch
- **THEN** the new branch SHALL copy the direct parent Thread's `modelId` and its selector SHALL remain disabled

### Requirement: Externally controllable selector disabled state

The reusable model selector SHALL accept an externally controlled disabled state. Thread Chat SHALL disable the selector when the Thread is a branch or when that Thread is generating a response.

#### Scenario: Generation locks the main selector

- **WHEN** the root Thread is actively generating a response
- **THEN** its model selector SHALL be disabled until generation stops

#### Scenario: Idle main selector is enabled

- **WHEN** the root Thread is idle and no external disable policy applies
- **THEN** its model selector SHALL permit selecting another configured model

### Requirement: Thread Chat request model validation

Every Thread Chat request SHALL include the owning Thread's current `modelId`. The server SHALL accept registered model ids, SHALL use the default for an omitted id to preserve old-client compatibility, and SHALL reject an explicitly supplied invalid id with HTTP 400.

#### Scenario: Current Thread model is sent

- **WHEN** a Thread sends a new user message
- **THEN** the request body SHALL contain that Thread's current `modelId`

#### Scenario: Unknown model is rejected

- **WHEN** a request explicitly supplies a `modelId` that is not present in the shared registry
- **THEN** the server SHALL respond with HTTP 400 and SHALL not call any model provider

#### Scenario: Omitted model remains compatible

- **WHEN** an older client sends a valid chat request without `modelId`
- **THEN** the server SHALL use `DEFAULT_MODEL_ID`

### Requirement: Persisted tree compatibility

Thread tree persistence SHALL save each Thread's `modelId`. Loading a legacy Thread without a model id, or a Thread with a model id no longer present in the registry, SHALL replace that value with `DEFAULT_MODEL_ID` without discarding messages or branches.

#### Scenario: Legacy tree is upgraded on load

- **WHEN** persisted Thread data contains Threads without `modelId`
- **THEN** the loader SHALL retain the tree and assign `DEFAULT_MODEL_ID` to each affected Thread

#### Scenario: Removed model is sanitized on load

- **WHEN** persisted Thread data references a model that is no longer registered
- **THEN** the loader SHALL retain the Thread and replace only its model id with `DEFAULT_MODEL_ID`

### Requirement: Ark models have nonzero billing configuration

Every Ark model exposed by the selector SHALL have a nonzero cost entry compatible with the existing billing calculation, so an Ark generation is never treated as free because of a missing pricing key.

#### Scenario: Ark usage is charged

- **WHEN** an Ark response reports token usage
- **THEN** the billing pipeline SHALL calculate a positive estimated cost and selling price for that registered model
