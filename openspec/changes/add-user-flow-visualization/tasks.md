## 1. Domain contract

- [x] 1.1 Define versioned `FlowSpec`, `FlowNode`, `FlowEdge`, `FlowGroup`, direction, and node-kind types under `lib/visualization/`.
- [x] 1.2 Define Zod schemas from the same domain contract and keep renderer-specific fields out of the persisted schema.
- [x] 1.3 Add tests that reject renderer/layout-only fields from fixtures intended to represent the domain `FlowSpec`.

## 2. Deterministic verification

- [x] 2.1 Implement schema validation for supported version, enums, required fields, and V1 node/edge limits.
- [x] 2.2 Implement renderer-independent graph verification for duplicate node/edge IDs, unknown endpoints, duplicate edges, invalid groups, and forbidden self-loops.
- [x] 2.3 Return structured verification errors suitable for repair and observability.
- [x] 2.4 Add unit coverage for every required invalid-graph scenario.

## 3. Dedicated visualization generation

- [x] 3.1 Define `GenerateVisualizationInput` with `kind=user-flow`, natural-language prompt, and optional direction.
- [x] 3.2 Add separately configurable low-cost visualization model routing that does not inherit the user's selected main chat model by default.
- [x] 3.3 Implement natural-language-to-`FlowSpec` structured generation.
- [x] 3.4 Implement repair using the failed `FlowSpec` plus deterministic verification errors.
- [x] 3.5 Enforce `MAX_ATTEMPTS = 3` across initial generation and repair attempts.
- [x] 3.6 Ensure terminal generation failure cannot persist an invalid successful visualization part.

## 4. Tool integration

- [x] 4.1 Register `generate_visualization` in the existing Tool registry.
- [x] 4.2 Make the Tool description encourage use for user/product/business/agent flows without requiring the main model to author nodes, edges, SVG, or library schemas.
- [x] 4.3 Return verified `FlowSpec` plus verification metadata from the Tool result.
- [ ] 4.4 Add tests proving the Tool contract remains unchanged when the visualization model implementation changes.

## 5. Message persistence

- [x] 5.1 Add typed `data-visualization` assistant message part support for `kind=user-flow` and versioned `FlowSpec`.
- [x] 5.2 Persist `FlowSpec` only; do not store final SVG, HTML, positions, React Flow nodes, ELK graph objects, or other renderer output as the authoritative visualization data.
- [ ] 5.3 Verify serialization/deserialization and historical message loading for the new part.
- [ ] 5.4 Verify existing Thread/Fork/Share/Snapshot behavior carries the visualization part through the existing Message lifecycle without a new visualization ownership table.

## 6. Renderer adapter boundary

- [x] 6.1 Define an explicit `FlowRendererAdapter<TGraph>`-style boundary from `FlowSpec` to renderer-specific graph data.
- [x] 6.2 Implement the V1 adapter and chosen layout/rendering library without adding library-specific fields to `FlowSpec`.
- [x] 6.3 Keep positions, handles, node component types, styles, routing metadata, layout options, and library enums inside Adapter/Renderer code.
- [x] 6.4 Add a second mock adapter test that consumes the same `FlowSpec` and proves Tool, storage, domain verification, and persisted fixtures do not need changes when the renderer is replaced.
- [x] 6.5 Document that future persisted manual layout, if needed, must use a separate presentation/layout layer rather than modifying semantic `FlowSpec` with third-party fields.

## 7. Frontend rendering

- [x] 7.1 Add `VisualizationBlock` routing for `user-flow`.
- [x] 7.2 Add `FlowCanvas` and focused node/edge rendering components.
- [ ] 7.3 Reuse or extract the existing Mermaid diagram shell/toolbar where practical.
- [x] 7.4 Support Preview/Source, Fit, Zoom Out, Zoom In, and Reset.
- [ ] 7.5 Verify desktop and mobile rendering for representative horizontal and vertical flows.

## 8. Renderer replacement acceptance

- [x] 8.1 Add an acceptance test or fixture demonstrating that replacing the V1 adapter/renderer does not require migration of existing `data-visualization` message data.
- [x] 8.2 Confirm renderer replacement does not require changing `GenerateVisualizationInput`, generation responsibilities, or renderer-independent Schema/Graph Verify.
- [ ] 8.3 Confirm a renderer-specific capability gap degrades in Adapter/Renderer instead of introducing a third-party field into `FlowSpec`.

## 9. Observability and evaluation

- [x] 9.1 Record visualization model identity, generation latency, first-pass verification result, repair count, and final verification outcome.
- [x] 9.2 Record provider usage/token information when available without coupling product billing to the renderer.
- [ ] 9.3 Add a small evaluation set covering linear flows, decisions, groups, invalid references, repair success, and renderer-independent historical fixtures.

## 10. Deferred follow-ups

- [ ] 10.1 Evaluate renderer-specific Render Verify after the V1 renderer is stable.
- [ ] 10.2 Evaluate low-cost-model Semantic Verify for structurally valid but semantically incomplete flows.
- [ ] 10.3 Propose separate OpenSpec changes for Sankey, Network, Architecture, persisted manual layout, or additional visualization families rather than expanding V1 implicitly.

## 11. Validation and release

- [x] 11.1 Run `openspec validate add-user-flow-visualization --strict` and resolve all validation errors.
- [x] 11.2 Run `openspec validate --all --strict` and ensure the new change does not break existing specs.
- [ ] 11.3 Run typecheck, relevant unit/integration tests, and production build after implementation. (`typecheck` and User Flow contract tests pass in Visualization CI; production build remains pending because the current Vercel preview fails earlier in the existing database migration step.)
- [x] 11.4 Verify no renderer-specific schema has become part of authoritative message persistence before marking the change complete.
