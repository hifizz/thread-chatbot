## ADDED Requirements

### Requirement: Column chrome matches the workbench

The demo SHALL render workbench-faithful column chrome in every lane: main header (`锚定` + `主线` + subtitle + subtree count + mobile menu entry), branch header (clickable crumb chain + `L{depth}` badge + title + subtree count + `⇄ 切换` + `收起`), focus banner (`讨论焦点 · 划选自…` + quoted anchor), and the `继承的上文 · N 条` disclosure with truncated `你`/`AI` rows.

#### Scenario: Read branch provenance

- **WHEN** a visitor opens a branch lane
- **THEN** the lane shows where it forked from, the frozen anchor quote, and an expandable inherited-context list

#### Scenario: Manage columns

- **WHEN** a visitor uses switch, collapse, strip-expand, resize, or crumb-back controls
- **THEN** the columns update locally without navigation, and collapsed lanes render as vertical strips with footnote badge and upright title

### Requirement: Message presentation matches the workbench

User turns SHALL render as right-aligned bubbles with `你` labels and hover toolbars (copy; edit affordance limited to the latest turn). Assistant turns SHALL render as prose bubbles with `AI` labels, streaming caret/typing states, Markdown headings/lists/tables, underline highlight on forked spans, superscript footnote badges that open the target branch (with `⌘` retaining the source column), and an action row (copy, regenerate limited to latest, positive/negative feedback).

#### Scenario: Open a branch from a footnote

- **WHEN** a visitor clicks an underlined anchor or its superscript badge
- **THEN** the child branch opens beside its source and the badge number matches the branch footnote

#### Scenario: Use message actions locally

- **WHEN** a visitor copies, regenerates, or rates a demo message
- **THEN** the action completes against local demo state with visible confirmation and never calls a model or writes a session

### Requirement: Text-selection branching flow

Assistant prose SHALL support native text selection that opens the two-action toolbar (`在当前对话问` / `此处提问`, with arrow-key navigation), then the question bubble (`在新分支中讨论这段` + quote + optional question input + placement preview + `开启分支讨论` / `带着问题开分支`). Submitting SHALL open the branch in the adjacent column with the selected text as its frozen anchor; empty submission keeps the kickoff prefill awaiting confirmation.

#### Scenario: Branch from a selection

- **WHEN** a visitor selects assistant text and submits the bubble with or without a question
- **THEN** a new branch lane appears to the right carrying the anchor and inherited context

#### Scenario: Quote in the current thread

- **WHEN** a visitor chooses the continue-in-place action
- **THEN** the quote is inserted into the current composer as pending context instead of opening a branch

### Requirement: Composer matches the workbench

Each lane composer SHALL present the workbench affordances: attachment entry, model selector (editable on the main lane, locked with an explanatory reason on branches), generation-settings entry, disabled voice placeholder, and a send control that becomes stop during demo streaming. Typing `@` on the scripted main lane SHALL open the artifact mention menu; selecting an entry SHALL insert a non-editable reference capsule that can be removed before sending.

#### Scenario: Reference an artifact with @

- **WHEN** a visitor types `@`, picks the scripted artifact, and sends
- **THEN** a capsule is inserted, removable via its control, and sending continues the scripted main-line conclusion locally

#### Scenario: Branch composer stays locked

- **WHEN** a visitor opens the model selector in a branch lane
- **THEN** the control explains that branch lanes follow the main-lane model instead of changing it

### Requirement: Artifact cards match the workbench

Scripted artifact output SHALL use the workbench card structure (icon + title + kind line + open affordance, with depth accent) and the dashed generation placeholder (status role, spinner, character/line detail, recent headings, progress track) before the artifact resolves.

#### Scenario: Generate then open the artifact

- **WHEN** the scripted branch produces its artifact
- **THEN** the visitor first sees the generation placeholder and then the completed card, which opens the local preview without navigation

### Requirement: Columns scroll and resize like the workbench

Expanded lanes SHALL be separated by draggable column resizers (with keyboard stepping and double-click reset), each message list SHALL offer a scroll-to-end control that hides while pinned to the bottom, and branch lanes SHALL expose a subtree entry showing child-branch count.

#### Scenario: Adjust the reading layout

- **WHEN** a visitor drags a divider, collapses a lane, or scrolls up
- **THEN** widths persist for the session, collapsed lanes fold to strips, and the scroll-to-end control appears until the lane returns to the bottom

### Requirement: Playback and cursor follow the faithful DOM

The chapter playback, replay, pause-on-interact, reduced-motion, and background-tab pause semantics SHALL be preserved, and every virtual-cursor target SHALL resolve against the aligned DOM so the cursor lands on the same control the chapter narrates.

#### Scenario: Play the full story

- **WHEN** a visitor plays a scenario end to end
- **THEN** chapters advance through forking, deepening, and (where scripted) artifact referencing, with the cursor landing on visible controls

### Requirement: Local-only demo isolation

All demo behavior SHALL run against the six bundled scripts locally: no model calls, no session creation, no database writes, no new dependencies, and no shared workbench code or `.tc` styles. Demo styles SHALL stay scoped inside `.threadchat-landing`, and exiting to the workbench SHALL NOT leak demo styles or state.

#### Scenario: Explore freely without side effects

- **WHEN** a visitor branches, sends, references, or replays any scenario
- **THEN** reloading the homepage restores the scripted start and no user session or library data was created

#### Scenario: Scripts stay intact

- **WHEN** a visitor switches among the six scenario scripts
- **THEN** each script keeps its approved questions, answers, anchors, headings, tables, notes, artifact behavior, sources, and notices
