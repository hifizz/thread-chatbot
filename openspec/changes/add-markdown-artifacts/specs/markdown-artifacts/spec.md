## ADDED Requirements

### Requirement: Semantic Markdown deliverable detection

The system SHALL treat a request as a Markdown Artifact request when the user semantically asks to create, generate, output, organize, rewrite, or deliver a standalone Markdown or `.md` document, regardless of whether the request is expressed in Chinese, English, mixed language, or an equivalent natural-language phrasing. The tool description and ThreadChat system instruction MUST describe this rule in both Chinese and English and MUST NOT require one exact keyword or sentence template.

#### Scenario: Chinese Markdown request

- **WHEN** the user says “请帮我生成一个 Markdown，总结这次讨论” or an equivalent Chinese expression
- **THEN** the system invokes `createMarkdownArtifact` and produces one Markdown Artifact attached to the reply

#### Scenario: English Markdown request

- **WHEN** the user says “Create an .md document that summarizes our discussion” or an equivalent English expression
- **THEN** the system invokes `createMarkdownArtifact` and produces one Markdown Artifact attached to the reply

#### Scenario: Mixed or paraphrased request

- **WHEN** the user expresses the intent to receive a standalone Markdown deliverable using mixed language or wording not present in the examples
- **THEN** the system uses semantic intent rather than exact phrase matching to select `createMarkdownArtifact`

### Requirement: Non-deliverable Markdown mentions do not create Artifacts

The system SHALL distinguish a Markdown deliverable request from an informational question about Markdown and from ordinary assistant prose that merely uses Markdown formatting.

#### Scenario: Asking what Markdown is

- **WHEN** the user asks “Markdown 是什么？” or “How does Markdown work?” without requesting a standalone document
- **THEN** the system returns a normal inline assistant response and does not create a Markdown Artifact

#### Scenario: Ordinary structured answer

- **WHEN** the user asks a normal question and the assistant uses headings, lists, emphasis, or code blocks for readability
- **THEN** the response remains an inline Markdown-rendered message and does not create a Markdown Artifact solely because it contains Markdown syntax

### Requirement: Typed Markdown tool contract

The system MUST define a shared `MarkdownArtifactInput` contract containing a non-empty `title` string and a non-empty `content` string, and the server SHALL validate model tool input against the corresponding schema before exposing it to the client. `content` SHALL represent raw renderable Markdown rather than an entire document wrapped in one outer Markdown code fence.

#### Scenario: Valid tool input

- **WHEN** the model calls `createMarkdownArtifact` with a valid title and Markdown content
- **THEN** the server emits a complete `tool-input-available` event whose typed input matches `MarkdownArtifactInput`

#### Scenario: Whole-document outer fence

- **WHEN** otherwise valid content is wrapped by exactly one outer `markdown` or `md` code fence
- **THEN** the system removes only that outer fence before storing and rendering the document

#### Scenario: Invalid tool input

- **WHEN** the tool input has an empty title, empty content, or incompatible field types
- **THEN** the system does not register or attach an Artifact and exposes a recoverable generation error

### Requirement: Atomic Artifact attachment to the producing message

The system SHALL register a Markdown Artifact and attach its id to the producing assistant message in one store operation. A failed attachment MUST NOT leave an Artifact in the registry or order list without a valid message reference.

#### Scenario: Successful attachment

- **WHEN** the client receives the first valid `createMarkdownArtifact` input event for the active assistant message
- **THEN** exactly one `markdown` Artifact is stored and its id is appended to that message’s `artifactIds`

#### Scenario: Duplicate stream event

- **WHEN** the same `toolCallId` is observed more than once in one response stream
- **THEN** the system ignores subsequent copies and displays only one Markdown card

#### Scenario: Missing target message

- **WHEN** a valid tool event arrives after its target thread or assistant message no longer exists
- **THEN** the system performs no partial registry mutation

### Requirement: Markdown card and panel rendering

The system SHALL insert a Markdown card in the assistant message flow after the tool input is complete. The card MUST use Markdown-specific iconography and labels, and clicking it SHALL open the existing right-side Artifact drawer with the document rendered through the shared `MarkdownBody` GFM renderer.

#### Scenario: Open generated Markdown

- **WHEN** the user clicks a Markdown card in the column message flow
- **THEN** the right-side panel opens, selects that Artifact, and renders headings, lists, tables, links, inline code, and fenced code blocks as Markdown

#### Scenario: Artifact-only reply

- **WHEN** an assistant reply contains a Markdown Artifact and no text body
- **THEN** the message flow displays the Markdown card without an empty assistant bubble

#### Scenario: Canvas message flow

- **WHEN** a message containing a Markdown Artifact is viewed in an expanded canvas node
- **THEN** the same Markdown card is visible and opens the same global right-side panel without turning the Artifact into a separate canvas node

### Requirement: Artifact-aware response lifecycle

The system SHALL treat a valid attached Markdown Artifact as meaningful assistant output even when no text delta was received. Stop, retry, and error handling MUST preserve one coherent terminal state.

#### Scenario: Tool-only completion

- **WHEN** a response completes after attaching a valid Markdown Artifact and has no text deltas
- **THEN** the assistant message finishes with status `done` and is not marked “未收到任何回复”

#### Scenario: Stop after Artifact completion

- **WHEN** the user stops generation after a complete Markdown Artifact was attached
- **THEN** the system preserves the Artifact and finishes the message

#### Scenario: Retry Artifact reply

- **WHEN** the user retries a reply that already owns one or more Artifacts
- **THEN** the system removes the old message-owned Artifacts from the registry and order list before generating replacements

### Requirement: Markdown Artifact persistence and recovery

The system SHALL persist Markdown Artifacts, their order, source thread, and message associations inside the existing `ThreadTreeState` JSON. Reload recovery MUST consider a valid Artifact association to be renderable output.

#### Scenario: Reload completed Artifact

- **WHEN** a tree containing a completed Markdown Artifact is saved and reloaded
- **THEN** the message card, document content, active drawer selection behavior, and source-thread association are restored without a database schema migration

#### Scenario: Reload interrupted Artifact-only message

- **WHEN** a saved assistant message is pending or streaming, has no text, but references a valid Markdown Artifact
- **THEN** sanitize changes the message to `done` instead of deleting it

#### Scenario: Orphan reference

- **WHEN** loaded state contains a missing message-to-Artifact reference or an unreferenced registry entry
- **THEN** sanitize ignores the bad reference and prevents an orphan card or runtime failure

### Requirement: Artifact content participates in conversation context

The system SHALL serialize the title and content of message-owned Markdown Artifacts into subsequent model context for the current thread and inherited branch history, even when the producing message has no text body.

#### Scenario: Follow-up modification

- **WHEN** the user asks “把刚才的 Markdown 再加一节风险分析” after an Artifact-only reply
- **THEN** the next model request contains the prior Markdown title and content so the model can produce a grounded revision

#### Scenario: Inherited Markdown context

- **WHEN** a child branch inherits a parent message containing a Markdown Artifact
- **THEN** the serialized Artifact content participates in the existing inherited-character budget and is either included whole according to that policy or covered by its omission notice

### Requirement: Artifact-aware branch metadata

The system SHALL treat a completed Markdown Artifact as a valid assistant answer when deriving branch titles and message summaries.

#### Scenario: Artifact-only first branch answer

- **WHEN** the first completed assistant answer in a branch contains only a Markdown Artifact
- **THEN** branch-title generation uses the Artifact title and content summary rather than waiting forever for non-empty message text

### Requirement: Progressive Markdown generation feedback

The system SHALL expose the real lifecycle of Markdown tool-input generation in the message flow. Progress feedback MUST occupy the final card position, MUST NOT be clickable before validated input is complete, and MUST NOT present a fabricated percentage when total work is unknown.

#### Scenario: Tool input starts

- **WHEN** `tool-input-start` is received for `createMarkdownArtifact`
- **THEN** the assistant message immediately displays a non-clickable Markdown progress card with an indeterminate active state

#### Scenario: Tool input streams

- **WHEN** one or more matching `tool-input-delta` events are received
- **THEN** the progress card updates from repaired partial JSON with the available partial title, real Markdown character count, real line count, and up to three recent ATX headings

#### Scenario: Tool input completes

- **WHEN** the validated `tool-input-available` event arrives
- **THEN** the temporary progress card is removed and atomically replaced by the completed clickable Markdown Artifact card

### Requirement: Markdown progress remains transient

The system MUST NOT persist incomplete Markdown generation progress or partial tool input in `branch_trees.state`. Completion, failure, abort, retry, and reload recovery MUST clear any temporary Markdown progress.

#### Scenario: Debounced save during generation

- **WHEN** a tree save occurs while a Markdown tool input is still streaming
- **THEN** the persisted state excludes `markdownGeneration` and all partial Markdown input while the live page continues to display progress

#### Scenario: Stale progress in a loaded snapshot

- **WHEN** a legacy or malformed snapshot contains temporary Markdown generation progress
- **THEN** sanitize removes the progress and applies the existing interrupted-message recovery rules

### Requirement: Visible text and terminal Markdown behavior

Whitespace-only text deltas MUST NOT produce a bare streaming caret or count as meaningful assistant text. A completed `createMarkdownArtifact` call SHALL terminate the model loop for that response.

#### Scenario: Leading whitespace delta

- **WHEN** an assistant has received only spaces or line breaks and no Artifact progress is active
- **THEN** the message continues to show the ordinary waiting indicator without a visible empty bubble or bare caret

#### Scenario: Markdown tool completes

- **WHEN** `createMarkdownArtifact` is called successfully
- **THEN** the server stops before a second model step and the client does not stream a redundant generated-document recap
