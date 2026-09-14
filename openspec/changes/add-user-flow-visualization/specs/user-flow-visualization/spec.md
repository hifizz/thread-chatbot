## Purpose

为 ThreadChat 提供可由自然语言生成、经过验证、可持久化并可替换具体画图实现的 User Flow 可视化能力；保证图表业务语义长期由稳定的 ThreadChat 领域 IR 表达，而不是绑定到某个 renderer 或 layout library。

## ADDED Requirements

### Requirement: Users can request a User Flow using natural language

The system SHALL allow a user to request a user-flow visualization using ordinary chat language without requiring the user to author a graph DSL, SVG, HTML, or renderer-specific schema.

#### Scenario: User asks for a product flow

- **WHEN** the user asks the assistant to draw or visualize a product/user process
- **THEN** the assistant can invoke the visualization tool and return a rendered User Flow inside the assistant response

#### Scenario: User does not specify a renderer

- **WHEN** the user asks for a User Flow without naming a graph library
- **THEN** the system chooses its configured renderer internally and does not expose renderer-specific syntax as a prerequisite

### Requirement: The main chat model delegates visualization generation to a dedicated Tool

The main chat model SHALL describe the requested visualization through `generate_visualization` and MUST NOT directly generate persisted SVG, HTML, React code, layout coordinates, or third-party graph-library data as the product visualization payload.

#### Scenario: Main model requests a User Flow

- **WHEN** the main model determines that a User Flow will improve the answer
- **THEN** it calls `generate_visualization` with `kind=user-flow`, a natural-language prompt, and an optional direction

#### Scenario: User-selected chat model changes

- **WHEN** the user selects a different main chat model
- **THEN** visualization generation can continue using the independently configured visualization model without changing the persisted visualization contract

### Requirement: Visualization generation uses a dedicated low-cost model boundary

The system SHALL route User Flow generation through a separately configurable visualization model whose responsibility is natural language to `FlowSpec`. The visualization model MUST NOT be required to generate SVG, HTML, React code, or renderer-specific graph structures.

#### Scenario: Visualization model is replaced

- **WHEN** the configured low-cost visualization model changes from one provider/model to another
- **THEN** the Tool input, `FlowSpec`, message storage, and renderer contract remain compatible

### Requirement: FlowSpec is the stable ThreadChat domain IR

The system SHALL define `FlowSpec` as a versioned ThreadChat-owned intermediate representation containing only domain semantics required to describe a User Flow. `FlowSpec` MUST remain independent of any concrete renderer or layout library.

#### Scenario: A normal action node is generated

- **WHEN** the visualization model represents an action in a User Flow
- **THEN** the persisted node contains semantic fields such as id, label, optional description, and node kind rather than renderer coordinates or component types

#### Scenario: A renderer requires implementation metadata

- **WHEN** a concrete renderer requires position, handles, styles, node types, rank hints, layout options, or other library-specific metadata
- **THEN** that metadata is produced by the renderer adapter and is not added to the persisted `FlowSpec`

#### Scenario: A new presentation requirement appears

- **WHEN** a future feature requires user-persisted manual layout or presentation state
- **THEN** that state is designed as a separate versioned presentation/layout layer rather than silently expanding the semantic `FlowSpec` with third-party fields

### Requirement: Persisted visualizations use a typed message part

The system SHALL persist a verified User Flow as a `data-visualization` assistant message part containing the visualization kind and versioned `FlowSpec`. The system MUST NOT persist final SVG, HTML, or third-party renderer schema as the authoritative visualization data.

#### Scenario: Assistant response contains a User Flow

- **WHEN** a verified User Flow is committed as part of an assistant response
- **THEN** the message stores a `data-visualization` part whose authoritative data is the `FlowSpec`

#### Scenario: Thread is forked or shared

- **WHEN** an assistant message containing a visualization participates in existing Thread fork, share, or snapshot behavior
- **THEN** the visualization follows the existing Message lifecycle without requiring a separate visualization ownership table

#### Scenario: Renderer changes after old messages exist

- **WHEN** the application deploys a different renderer implementation
- **THEN** previously stored User Flow message parts remain readable and renderable without migrating their business data solely because the renderer changed

### Requirement: FlowSpec schema validation is deterministic

Before a generated User Flow is accepted, the system SHALL validate it using a deterministic schema. Validation MUST reject malformed or unsupported versions, invalid enums, missing required fields, and configured node/edge limit violations.

#### Scenario: Generated output is malformed

- **WHEN** the visualization model returns data that does not conform to the supported `FlowSpec` schema
- **THEN** the output is not persisted or rendered as a successful visualization

#### Scenario: Generated graph exceeds configured limits

- **WHEN** generated nodes or edges exceed the supported V1 limits
- **THEN** schema validation fails and the result enters bounded repair or final failure handling

### Requirement: Flow graph validation is deterministic and renderer-independent

After schema validation, the system SHALL run deterministic graph validation over `FlowSpec`. Graph validation MUST NOT depend on the selected renderer or an LLM.

Graph validation SHALL at minimum verify unique node ids, unique edge ids, valid edge endpoints, valid group references, no forbidden self-loops, and no exact duplicate edges.

#### Scenario: Edge references a missing node

- **WHEN** an edge references a source or target node id that does not exist in the same `FlowSpec`
- **THEN** graph verification fails with a structured validation error

#### Scenario: Renderer is replaced

- **WHEN** the application changes to a different renderer or layout engine
- **THEN** the same schema and graph verification rules continue to validate the domain `FlowSpec`

### Requirement: Failed generated graphs use bounded repair

The system SHALL support repair of invalid generated `FlowSpec` values by returning the current spec and validation errors to the configured visualization model. The full generation process MUST be bounded to at most 3 total generation/repair attempts.

#### Scenario: First generated graph has an invalid edge

- **WHEN** the first generated `FlowSpec` fails deterministic validation
- **THEN** the system may request a repair using the failed spec and validation errors and then reruns deterministic validation

#### Scenario: Repeated repair fails

- **WHEN** the visualization remains invalid after the maximum allowed attempts
- **THEN** the Tool returns or raises a bounded visualization-generation failure and does not enter an unbounded agent loop

### Requirement: Only verified FlowSpec reaches successful persistence and rendering

A User Flow SHALL be considered successfully generated only after required deterministic verification passes. Invalid output MUST NOT be silently persisted as a successful `data-visualization` part.

#### Scenario: Verification passes

- **WHEN** schema and graph verification both pass
- **THEN** the verified `FlowSpec` may be returned to the main model and persisted/rendered as a User Flow

#### Scenario: Verification fails terminally

- **WHEN** the maximum repair attempts are exhausted without a valid `FlowSpec`
- **THEN** no successful visualization part is committed for that failed result

### Requirement: Rendering is isolated behind a replaceable adapter boundary

The frontend SHALL convert `FlowSpec` to concrete renderer/layout data through an explicit adapter boundary. Renderer-specific graph structures MUST remain inside the adapter/renderer layer and MUST NOT become the Tool DTO or persisted message format.

#### Scenario: Current renderer converts a FlowSpec

- **WHEN** a verified `FlowSpec` is rendered
- **THEN** a renderer adapter converts semantic nodes/edges/groups into the concrete graph/layout representation required by that renderer

#### Scenario: React Flow is replaced by another implementation

- **WHEN** the implementation switches between React Flow, ELK, Dagre, custom SVG/Canvas, or another graph engine
- **THEN** the replacement is implemented in the adapter/renderer/layout layer without requiring changes to existing message data or main Tool input DTO

#### Scenario: New renderer lacks one visual feature

- **WHEN** the replacement renderer cannot represent a presentation detail supported by the previous renderer
- **THEN** the adapter/renderer degrades that presentation behavior without adding renderer-specific fields to the semantic `FlowSpec`

### Requirement: Renderer replacement does not redefine the domain contract

Changing the concrete graph implementation SHALL NOT, by itself, require changes to existing `FlowSpec` semantic fields, `GenerateVisualizationInput`, persisted `data-visualization` parts, the low-cost model responsibility, or renderer-independent Schema/Graph Verify behavior.

#### Scenario: Mock renderer replacement test

- **WHEN** tests replace the default renderer adapter with a second mock adapter that consumes the same valid `FlowSpec`
- **THEN** Tool tests, message serialization tests, domain verification tests, and persisted fixtures continue to pass without rewriting the stored graph data

#### Scenario: Library-specific property is proposed for FlowSpec

- **WHEN** an implementation requires a property whose meaning only exists in one renderer/layout library
- **THEN** the property is rejected from the domain `FlowSpec` and implemented in the adapter/renderer layer instead

### Requirement: User Flow rendering provides diagram navigation controls

The User Flow UI SHALL provide preview rendering and the same core navigation affordances expected from ThreadChat diagrams: source/spec inspection, fit-to-view, zoom out, zoom in, and reset. Shared shell/toolbar behavior SHOULD be reused with Mermaid where practical without requiring Mermaid to be rewritten as part of V1.

#### Scenario: User opens a generated User Flow

- **WHEN** a valid User Flow is displayed in an assistant response
- **THEN** the user can view the rendered graph and access fit, zoom, reset, and source/spec inspection controls

#### Scenario: Renderer is replaced

- **WHEN** the concrete renderer changes
- **THEN** the user-facing core diagram controls remain available even if their internal renderer integration changes

### Requirement: V1 remains limited to User Flow semantics

The V1 implementation SHALL support `user-flow` and MUST NOT require a universal diagram DSL or simultaneous implementation of Sankey, Network, Architecture, or other visualization families.

#### Scenario: Future visualization type is introduced

- **WHEN** a future change adds another visualization family
- **THEN** it may introduce another domain spec under a broader `VisualizationSpec` union while preserving the rule that each persisted spec remains independent of concrete renderer schemas

### Requirement: Visualization generation is observable

The system SHALL expose enough structured telemetry to measure visualization generation reliability and cost, including the configured generation model, first-pass outcome, repair count, final verification outcome, and generation latency. Token/usage cost SHOULD be recorded when the model provider exposes it.

#### Scenario: First attempt succeeds

- **WHEN** the generated `FlowSpec` passes verification on the first attempt
- **THEN** observability records a first-pass success and zero repairs

#### Scenario: Repair succeeds

- **WHEN** an invalid first result is repaired into a valid `FlowSpec`
- **THEN** observability records the repair count and final successful verification outcome
