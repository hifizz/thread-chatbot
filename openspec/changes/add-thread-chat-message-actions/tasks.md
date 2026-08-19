## 1. Freeze contracts and pure behavior

- [ ] 1.1 Re-read the repository's installed Next.js guidance before implementation and freeze the public contracts from `design.md`: immutable message-node graph, active leaf, generation start intents, recovery states, action command results, feedback values, and stable server error codes.
- [ ] 1.2 Extend the shared thread-chat TypeScript model with message `parentMessageId`, thread `activeLeafMessageId`, artifact `sourceMessageId`, `ThreadChatGenerationIntent`, `RecoverableTurn`, `MessageActionViewState`, and generation feedback fields without leaking component-local UI state into `ThreadTreeState`.
- [ ] 1.3 Implement and test the idempotent legacy linear-tree migration plus pure `activeMessagePath`, `messagePathTo`, `assistantTurnAlternatives`, inactive-source provenance, and active-path Artifact selectors, including cycle/missing-parent rejection.
- [ ] 1.4 Implement a pure `reconcileThreadChatTurns` function that merges persisted tree state with current generations, repairs missing graph nodes/active leaf, and returns explicit recoverable-turn metadata.
- [ ] 1.5 Implement pure active-leaf-turn validation and `prepareRegenerationPatch` helpers that only append sibling/child nodes and move the active leaf without mutating source nodes or deleting Artifacts.
- [ ] 1.6 Extract `compileThreadChatMessages` so current context follows the server-owned active path while inherited child-Thread context follows the exact `forkFromMsgId` source path.
- [ ] 1.7 Add table-driven unit tests covering every reconciliation state, generation intent, legacy migration, stale-PUT graph repair, message alternative, exact fork-source inheritance, Artifact visibility, quote/fork preservation, and context compilation.

## 2. Persist feedback and protect tree revisions

- [ ] 2.1 Add nullable positive/negative feedback and feedback-updated-at columns to `branch_generations` plus a default-0 monotonic revision on `branch_trees`; generate, review, and apply the migration locally.
- [ ] 2.2 Add owner-scoped repository operations for reading and updating generation feedback, including idempotent writes and switching between positive and negative.
- [ ] 2.3 Add `PUT /api/branch-generations/{generationId}/feedback` with request validation, authentication/ownership checks, and the shared response/error contract.
- [ ] 2.4 Include feedback in generation summaries returned by the tree and generation APIs so refresh restores the selected state.
- [ ] 2.5 Add database and API tests for set, repeat, switch, clear, refresh, unauthorized access, and feedback on a superseded generation.
- [ ] 2.6 Return tree revision from GET and require `baseRevision` for graph-tree PUT; update by owner/revision CAS and return stable `tree_revision_conflict` or `revision_required` responses without partial writes.
- [ ] 2.7 Add the owner-scoped active-leaf switch command that validates a latest-turn alternative, updates only that Thread's active leaf, increments revision, and returns the new revision/minimal patch.
- [ ] 2.8 Add concurrency tests for stale whole-tree PUT, stale variant switch, generation-vs-PUT races, refresh persistence, unauthorized switching, and refusal of legacy no-revision writes after schema upgrade.

## 3. Make regeneration intents atomic on the server

- [ ] 3.1 Extend the generation-start request schema compatibly to accept `persisted-turn`, `regenerate-assistant`, `retry-orphan-user`, and `edit-last-user` intents.
- [ ] 3.2 Refactor generation preparation into one database transaction that validates the active-leaf turn, creates the required sibling user and/or sibling assistant with fresh IDs, moves the active leaf, supersedes only an actually running replaced attempt, preserves all terminal source nodes/Artifacts, persists the graph, and creates the new generation plus graph-aware `turnSnapshot`.
- [ ] 3.3 Reject historical or structurally invalid mutations before any model request with stable `invalid_turn`, `not_latest_turn`, `generation_conflict`, or `persistence_failed` responses.
- [ ] 3.4 Extend graph-aware generation snapshots so reconciliation can restore missing new nodes/results without overwriting immutable source messages or overriding a later revision-controlled user variant selection.
- [ ] 3.5 Start the model only after the preparation transaction commits, and compile its context from the committed server state rather than client-provided messages.
- [ ] 3.6 Preserve current Stop behavior while making a submitted edit or regeneration supersede the prior current attempt for that same thread.
- [ ] 3.7 Add integration tests for orphan retry, edited-user sibling creation, assistant sibling regeneration, active-attempt supersession, terminal-source preservation, replay without duplicate siblings, historical-turn rejection, no paid model call after persistence failure, stale client PUT graph repair, and exact child-Thread provenance.

## 4. Reconcile tree reads and boot recovery

- [ ] 4.1 Make the tree GET path call the shared reconciliation function and return `revision` plus per-turn `recoverableTurns` rather than failing the whole tree for a local generation inconsistency.
- [ ] 4.2 Refactor initial load, polling, and generation completion to consume the same reconciliation result instead of maintaining separate sanitize/repair rules.
- [ ] 4.3 Keep active generations visible as background-loading assistant placeholders, merge terminal results, convert empty pending assistants with no generation into retryable errors, and expose last-user-without-assistant as `missing_assistant`.
- [ ] 4.4 Add regression tests for all four recovery cases and for false positives where a final user message already has a current generation or a valid adjacent assistant.

## 5. Expose headless message-action commands

- [ ] 5.1 Extend `ChatController` with the explicit `ThreadMessageActionCommands` contract for `retryAssistant`, `retryUserTurn`, `editAndRegenerate`, `switchTurnVariant`, and `submitFeedback`, returning `GenerationActionResult` rather than component-specific state.
- [ ] 5.2 Make controller mutations append prepared message nodes and move `activeLeafMessageId` atomically while leaving source message, fork, Artifact, quote, and generation records unchanged.
- [ ] 5.3 Wire retry, edit, and regenerate commands to generation intents and variant switching to the revision-controlled active-leaf endpoint; update the store only after durable acceptance.
- [ ] 5.4 Keep copy, editing draft, copied confirmation, submission, and feedback optimistic state outside `ThreadTreeState`, with persisted feedback reconciled back from server responses.
- [ ] 5.5 Ensure opening an editor does not stop an active request, while submitting the edit follows the same-thread supersession semantics defined by the server.
- [ ] 5.6 Handle revision conflicts by reloading instead of replaying the whole local tree; only explicitly safe domain commands may be reapplied after refresh.
- [ ] 5.7 Add controller/store tests for accepted, rejected, superseded, switched, conflicted, and refreshed actions, including immutable old message IDs, exact child-Thread sources, version-specific forks, and historical Artifact reachability.

## 6. Build reusable message-action UI

- [ ] 6.1 Add shared message-action types and a Markdown-copy hook that copies only raw `msg.text`, never rendered DOM, error notices, or artifact content.
- [ ] 6.2 Add an accessible shared `MessageToolbar` primitive with keyboard focus visibility, touch-compatible actions, busy/disabled states, copied feedback, tooltips, and reduced-motion behavior.
- [ ] 6.3 Add `EditableUserMessage` with hover/focus Copy and Edit actions, a controlled edit draft, Send/Cancel behavior, validation, and an orphan recovery notice exposing Retry and Re-edit.
- [ ] 6.4 Add `AssistantMessageToolbar` with Copy, Regenerate, Like, and Dislike actions, including persisted feedback selection.
- [ ] 6.5 Add `TurnVariantPicker` with ordered `1/N` navigation, derived-child count, keyboard labels, and a switch command that changes the complete visible turn.
- [ ] 6.6 Add scoped styles in `styles/message-actions.css`, import them in the documented order, and reuse the existing shimmer treatment for background generation without introducing global selectors.
- [ ] 6.7 Add component tests for raw Markdown copying, edit cancellation/submission, duplicate-submit prevention, action error recovery, variant switching, feedback switching, keyboard navigation, touch visibility, and reduced motion.

## 7. Integrate column and canvas renderers

- [ ] 7.1 Compute active paths, latest-turn eligibility, turn alternatives, version-specific child counts, and inactive-source provenance once in `ThreadChatDemoInner`, then pass the same commands and `MessageActionViewState` through both renderers.
- [ ] 7.2 Render the shared user and assistant action components in the column message renderer without changing current Markdown, quote, artifact, or loading output.
- [ ] 7.3 Render the same shared action components in canvas cards and remove any duplicate action-specific business logic from either view.
- [ ] 7.4 Disable edit/regenerate for historical turns with an explanatory tooltip while retaining copy and feedback where applicable.
- [ ] 7.5 Keep an already-open child column visible when its source version becomes inactive, add the historical-source badge and “查看来源” action, and ensure hidden-version forks do not appear on the active response.
- [ ] 7.6 Filter default inline/drawer Artifacts by active paths, preserve already-open historical tabs with source badges, and verify feedback, recovery, generation, action error, copied, variant, and Artifact state across column/canvas switches.

## 8. Verify behavior and release readiness

- [ ] 8.1 Run the focused pure, repository, API, controller, and component test suites, then run project typecheck, lint, and build checks.
- [ ] 8.2 Use the mandated `ego-browser nodejs` workflow against `localhost:4040` to verify copy, orphan retry/re-edit, latest-user sibling edit, active supersession, assistant sibling regeneration, `1/N` switching, historical-action disabling, feedback persistence/reset, and column/canvas parity.
- [ ] 8.3 Repeat owner-sensitive API flows with two authenticated users to verify that message actions and feedback cannot cross thread ownership boundaries.
- [ ] 8.4 Create a child Thread and Artifact from response A, regenerate response B with Artifact B, then verify across switching and refresh that the A-derived column remains usable, exact inherited context is unchanged, A/B forks do not cross-display, both Artifacts remain reachable, and no duplicate graph nodes appear.
- [ ] 8.5 Refresh during and after generation to verify background continuation, final answer persistence, recoverable-turn UI, stale-PUT graph repair, active-leaf persistence, and idempotent sibling creation.
- [ ] 8.6 Document graph migration/deployment ordering, compatibility and rollback steps, JSONB-size/provenance observability, intent/error/recovery fields, and known P0 latest-turn limitations.
- [ ] 8.7 Replace duplicated action/error/status strings with shared constants, format all touched files at the end, and run strict OpenSpec validation before handoff.
