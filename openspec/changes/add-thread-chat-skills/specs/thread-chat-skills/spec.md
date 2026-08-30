## Purpose

让 Thread Chat 用户能够通过 Slash 菜单选择受管理员控制的运行时 Skill，并保证 Skill 在 Thread、Fork、Generation、Retry/Edit、Prompt Cache、观测与评测中的状态明确、可恢复、可复现且不扩大工具权限。

## ADDED Requirements

### Requirement: The system provides a validated runtime Skill catalog

The system SHALL expose a server-owned catalog of enabled runtime Skills. Each catalog entry MUST resolve to one immutable current SkillVersion containing normalized metadata, instructions, resources, activation mode, capability profile, content digest, and a safe source revision identifier. Runtime Skills MUST be isolated from repository development-agent Skill directories.

#### Scenario: Built-in Research Skill is synchronized

- **WHEN** the operator runs the idempotent built-in Skill synchronization after migration
- **THEN** the catalog contains one enabled `research` Skill whose current immutable version has sticky activation and the approved `research-v1` capability profile

#### Scenario: The same package is synchronized again

- **WHEN** an operator imports a package whose normalized digest already exists for that Skill
- **THEN** the system reuses the existing SkillVersion and does not create a logically duplicate version

#### Scenario: A package changes

- **WHEN** an operator imports changed instructions, metadata, resources, activation mode, or capability profile
- **THEN** the system creates a new immutable SkillVersion and makes it current without changing Thread or Message references to older versions

### Requirement: MVP Skill packages are instruction-only and safely imported

The system SHALL accept only UTF-8 `SKILL.md` packages with supported frontmatter and bounded Markdown references. The importer MUST reject executable scripts, binaries, symbolic links, path traversal, oversized packages, invalid names, and unapproved capability profiles. The MVP MUST NOT execute package scripts or install package dependencies.

#### Scenario: A package contains scripts

- **WHEN** an administrator attempts to import a Skill package containing `scripts/` or another executable file
- **THEN** validation fails before catalog publication and no executable content becomes available to a Generation

#### Scenario: A package requests an unknown tool set

- **WHEN** frontmatter requests a capability profile not present in the server allowlist
- **THEN** import fails instead of creating a profile or granting tools from package text

#### Scenario: A reference uses an unsafe path

- **WHEN** a package contains an absolute path, `..` traversal, duplicate normalized path, or symlink
- **THEN** validation fails and the package is not published

### Requirement: Slash input discovers Skills without changing user text

The Composer SHALL open a keyboard-accessible Skill menu when the first draft token begins with `/`. Selecting an option SHALL remove the Slash token, preserve the remaining draft, and show exactly one Skill Chip. The Slash token and Skill instructions MUST NOT be persisted as user Message text.

#### Scenario: User selects Research and sends a request

- **WHEN** the draft is `/research 调研这个需求`, the user selects Research, and the turn is accepted
- **THEN** the persisted user text is `调研这个需求`, the Composer displays Research as selected, and the assistant Message identifies the fixed Research SkillVersion

#### Scenario: User uses the keyboard

- **WHEN** the menu is open and the user presses Arrow keys followed by Enter or Tab outside IME composition
- **THEN** the highlighted Skill is selected without sending the message

#### Scenario: User presses Escape

- **WHEN** the Slash menu is open
- **THEN** Escape closes the menu before affecting the draft, selected Skill, or surrounding workspace overlay

#### Scenario: Generation is active

- **WHEN** the current Thread has a generating assistant Message
- **THEN** Skill switching and clearing are disabled until the Generation reaches a terminal state

### Requirement: Exactly one Skill selection is effective at a time

The system SHALL support at most one selected Skill per Composer and one active sticky Skill per Thread. Selecting another Skill SHALL replace the previous selection. The system MUST NOT concatenate multiple Skill instructions or union package-requested permissions.

#### Scenario: User switches from Research to another sticky Skill

- **WHEN** Research is active and the user selects another sticky Skill
- **THEN** the Thread active pointer changes to the new SkillVersion and future new turns no longer use Research

#### Scenario: User selects a one-shot Skill while a sticky Skill is active

- **WHEN** the user explicitly selects a one-shot Skill
- **THEN** the previous sticky selection is cleared, the one-shot version is fixed only to the next accepted assistant Message, and no Skill remains active after acceptance

### Requirement: Sticky and one-shot activation have distinct persistence semantics

A sticky Skill SHALL persist as Thread state across turns and page reloads. A one-shot Skill SHALL remain a pending Composer selection until the next Start or Send command is accepted and SHALL then clear. Before the first Project exists, pending selection MAY be stored only as draft UI state and MUST be validated by the server on Start.

#### Scenario: Sticky Skill survives reload

- **WHEN** a Thread has an active Research Skill and the page reloads
- **THEN** Project bootstrap restores Research in that Thread's Composer without reconstructing the choice from message text

#### Scenario: One-shot send fails

- **WHEN** a one-shot Skill is selected but Start or Send fails before acceptance
- **THEN** the pending one-shot Chip remains available for retry and no assistant Message is falsely marked as using it

#### Scenario: One-shot send succeeds

- **WHEN** Start or Send accepts a one-shot Skill
- **THEN** the created assistant Message pins that SkillVersion and the Composer clears the pending selection

### Requirement: The server pins SkillVersion in the message-creation transaction

Start and Send SHALL resolve the effective SkillVersion while holding the existing conversation transaction and SHALL write the final version ID to the generating assistant Message. The client MUST provide only a catalog version ID or an explicit clear signal. Skill validation MUST finish before any paid answer model call starts.

#### Scenario: Send inherits the Thread Skill

- **WHEN** Send omits `skillVersionId` and the Thread has an active sticky Skill
- **THEN** the new assistant Message pins that exact version

#### Scenario: Send explicitly clears

- **WHEN** Send carries an explicit `null` Skill selection
- **THEN** the Thread sticky pointer is cleared and the new assistant Message has no SkillVersion

#### Scenario: Skill becomes unavailable

- **WHEN** the selected Skill is disabled, revoked, missing, corrupt, or has an unavailable capability profile
- **THEN** Start or Send fails with a typed safe error before the answer model is invoked and does not silently choose another version

#### Scenario: Skill is disabled after a Generation is accepted

- **WHEN** an assistant Message has already pinned a valid SkillVersion and its background Generation has started before an administrator disables the logical Skill
- **THEN** the accepted Generation keeps its pinned Prompt configuration, while later new-turn commands are rejected until the user clears or replaces the unavailable ActiveSkill

#### Scenario: Command is replayed

- **WHEN** an accepted idempotent Start, Send, or Thread update command is replayed
- **THEN** it returns the same Thread and assistant Message Skill resolution rather than creating another activation or Message

### Requirement: Fork captures the parent sticky Skill at the snapshot boundary

Creating a ForkedThread SHALL copy the parent Thread's active sticky SkillVersion in the same transaction that freezes Fork context. The child pointer SHALL be independent after creation. One-shot selections SHALL NOT be inherited.

#### Scenario: Fork is created from a Research Thread

- **WHEN** the parent Thread has Research active at Fork commit
- **THEN** the child Thread starts with the same Research SkillVersion and a first-turn Generation pins that copied version

#### Scenario: Parent later changes Skill

- **WHEN** the parent changes or clears its active Skill after the Fork
- **THEN** the child remains on the version captured at Fork time

#### Scenario: Parent used one-shot Skill

- **WHEN** a parent assistant Message used a one-shot Skill but the parent Thread has no sticky active Skill
- **THEN** a new child Thread starts without an active Skill

### Requirement: Retry and Edit preserve the historical Generation configuration

Retry/Regenerate SHALL copy the source assistant Message SkillVersion. Edit-and-Regenerate SHALL copy the replaced latest assistant Message SkillVersion when one exists. These operations MUST NOT read a newly changed Thread active Skill as a substitute and MUST NOT modify the Thread active pointer.

#### Scenario: Thread Skill changed after an answer

- **WHEN** an answer used Research, the Thread later switches Skill, and the user regenerates the old latest answer
- **THEN** the replacement assistant Message still pins the original Research SkillVersion

#### Scenario: User edits the latest turn

- **WHEN** the latest user turn and its assistant answer are replaced
- **THEN** the new assistant Message uses the replaced assistant's SkillVersion while preserving the Thread's separately configured active Skill

#### Scenario: Historical version is revoked

- **WHEN** Retry or Edit requires a now-revoked version
- **THEN** the operation fails explicitly before a model call instead of upgrading to the current version

### Requirement: Skill-driven Generation uses a stable capability profile

Each SkillVersion SHALL reference one server-defined capability profile. Effective tools MUST be the intersection of platform policy, deployment availability, and that profile. Tool names, descriptions, schemas, and serialization order SHALL remain stable for all turns using the same profile version.

#### Scenario: Research continues across checkpoints

- **WHEN** several turns use the same Research SkillVersion
- **THEN** each turn receives the same `research-v1` Tool Schema set, even when the latest user text alone would have produced different automatic research routes

#### Scenario: Search is not configured

- **WHEN** deployment capabilities cannot satisfy the required Research profile
- **THEN** the system rejects Research activation or Generation with `SKILL_CAPABILITY_UNAVAILABLE` rather than exposing a partially different unversioned tool set

#### Scenario: Skill text asks for another tool

- **WHEN** instructions request a tool outside the approved profile
- **THEN** the tool is not exposed and the Skill text cannot grant that permission

### Requirement: Skill references are loaded through a read-only bounded tool

An active Skill SHALL make its normalized reference index visible to the model and MAY expose a stable `readSkillResource` tool. The tool MUST resolve resources only from the assistant Message's pinned SkillVersion and MUST return bounded text with resource digest.

#### Scenario: Research needs its output template

- **WHEN** the model calls `readSkillResource` with an indexed Research reference path
- **THEN** it receives the immutable content and digest from the pinned version

#### Scenario: Model requests an unknown path

- **WHEN** a resource path does not exactly match the normalized index
- **THEN** the tool returns a typed not-found result without reading the application filesystem

#### Scenario: Skill changes after message creation

- **WHEN** a newer SkillVersion publishes a reference with the same path
- **THEN** an existing Generation still reads the old content pinned to its assistant Message

### Requirement: Skill-aware prompt compilation maximizes stable-prefix reuse

For Skill-driven Generation, the system SHALL compile a canonical prefix from stable Tool Schemas, platform/Agent instructions, Skill runtime contract, capability profile instructions, immutable Skill instructions, and a sorted resource index. Volatile runtime identities and dynamic plans MUST NOT be included in that stable prefix.

#### Scenario: Same Skill continues in one Thread

- **WHEN** consecutive turns use the same model family, agent prompt version, SkillVersion, and capability profile
- **THEN** they produce the same stable prefix digest and differ only in append-only conversation content after that prefix

#### Scenario: Answer is regenerated

- **WHEN** a terminal answer is regenerated with the same pinned configuration and user context
- **THEN** the stable prefix digest and effective Tool Schema digest are identical

#### Scenario: Skill version changes

- **WHEN** a Thread explicitly activates a different SkillVersion
- **THEN** the Skill block and digest change while the earlier platform/Agent block remains canonical

#### Scenario: Provider lacks explicit caching

- **WHEN** a model route does not support an explicit prompt cache option
- **THEN** the same canonical prefix is sent without unsupported provider parameters and Generation correctness is unchanged

### Requirement: Fork focus is compiled after the shared historical prefix

Fork anchor text SHALL NOT be inserted into the dynamic System Prompt for Skill-driven Generation. The context compiler SHALL deterministically associate it with the ForkedThread's first user model message while preserving stored user text and subsequent append-only compilation.

#### Scenario: Two sibling Forks share history

- **WHEN** two Forks originate from the same source Message but use different selected anchor text
- **THEN** their compiled prompts remain identical through the shared platform, Skill, and frozen history prefix and diverge only at each child focus/first-turn content

#### Scenario: Legacy Fork has no quote part

- **WHEN** an existing ForkedThread stores anchor metadata but its first user Message lacks a persisted quote part
- **THEN** the compiler derives the same bounded model-only focus part on every run without rewriting the user's stored text

### Requirement: Explicit Research Skill bypasses automatic research routing

When the pinned SkillVersion is Research, the system SHALL not invoke the generic research classifier or dynamic research-plan pre-call and SHALL not force a first-step Search tool. Research workflow checkpoints SHALL be governed by the immutable Skill instructions and conversation history. The no-Skill path SHALL retain its existing router behavior.

#### Scenario: First Research turn begins

- **WHEN** the user selects Research and submits a vague requirement
- **THEN** the assistant can perform Phase A clarification without an automatic planner call or forced Web Search before the response

#### Scenario: User confirms and continues

- **WHEN** a later short reply such as `确认，继续` is sent in the same sticky Research Thread
- **THEN** the same SkillVersion and tools remain available even though that latest text alone does not classify as a research request

#### Scenario: User does not select a Skill

- **WHEN** a normal request has no pinned SkillVersion
- **THEN** the existing answer/fetch/search/research router and planner continue to operate as before

### Requirement: Skill provenance is observable without exposing content

Each Skill-driven assistant Message SHALL attach Skill and prompt-cache provenance to the existing root Trace and evaluation result. Production telemetry MUST NOT record complete Skill instructions or resource bodies by default. Observability failure MUST NOT change conversation behavior.

#### Scenario: Skill-driven Generation completes

- **WHEN** Research produces a terminal assistant Message
- **THEN** its Trace identifies Skill ID, version ID, version label, digest, activation mode, capability profile, stable prefix digest, cache policy version, and available cache token usage

#### Scenario: Skill resource is read

- **WHEN** `readSkillResource` executes
- **THEN** a child Observation records safe path/digest/size/outcome metadata without exporting the resource body

#### Scenario: Remote observability is unavailable

- **WHEN** Trace export fails
- **THEN** Skill resolution, model execution, checkpointing, and Message finalization continue under existing observability failure isolation

### Requirement: The MVP ships deterministic and model-quality Skill evaluations

The project SHALL add a versioned Skill evaluation suite that separates deterministic state/security failures from probabilistic Research quality. Deterministic failures MUST NOT be hidden by a high model-judge score.

#### Scenario: Lifecycle regression is introduced

- **WHEN** a candidate loses sticky reload, Fork independence, one-shot clearing, Retry pinning, or disabled-before-model behavior
- **THEN** deterministic Skill cases fail regardless of response quality

#### Scenario: Research checkpoint adherence is evaluated

- **WHEN** baseline and candidate run the same vague Research request and confirmation turns
- **THEN** evaluators separately score goal clarification, checkpoint waiting, premature tool use, explicit assumptions, Research/Spec boundary, and final decision usefulness

#### Scenario: Cache layout changes

- **WHEN** a candidate changes Prompt block order, tool order, or includes a volatile identity
- **THEN** canonical prefix snapshot or digest tests identify the change and require an intentional cache policy version update
