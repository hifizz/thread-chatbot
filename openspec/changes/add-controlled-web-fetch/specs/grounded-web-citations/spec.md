## ADDED Requirements

### Requirement: Web-grounded messages SHALL own a structured source ledger
Each completed web-grounded assistant message SHALL persist a bounded source collection containing stable source ID, title, canonical URL, safe snippet metadata, and whether the source was deeply read. Full extracted page text MUST NOT be persisted.

#### Scenario: Reload a message with sources
- **WHEN** a branch tree containing a web-grounded message is saved and reloaded
- **THEN** the same compact sources remain associated with that message and are rendered without rerunning search

#### Scenario: Load an older message
- **WHEN** a stored message predates the source field
- **THEN** sanitization treats it as having no structured sources and preserves the message

### Requirement: Retrieved citations SHALL resolve to the message source ledger
For responses that used Web Search or Web Fetch, every information-source tag presented as retrieved evidence SHALL carry a source ID that resolves to that message's source ledger. Unknown or malformed source IDs MUST NOT become clickable retrieved-source links.

#### Scenario: Model cites a registered source
- **WHEN** the answer emits a valid inline citation marker for a source in the ledger
- **THEN** the UI renders a numbered verified source tag and can show its source details

#### Scenario: Model emits an unregistered citation
- **WHEN** the answer emits a citation marker whose source ID is absent from the ledger
- **THEN** the UI renders a visible non-clickable unverified-source state and does not invent a destination

### Requirement: Source tags SHALL be placed next to the supported content
The model SHALL place each source marker immediately after the smallest supported entity, factual claim, sentence, or paragraph. Sentence/claim placement SHALL be the default; entity placement SHALL be used only for an exact version/date/value/identity claim; paragraph placement SHALL be used only when the same sources support all material claims in that paragraph.

#### Scenario: Source supports one factual sentence
- **WHEN** a source supports one current factual sentence in a paragraph
- **THEN** its tag appears immediately after that sentence rather than only at the end of the answer

#### Scenario: Source supports an exact entity value
- **WHEN** the source verifies an entity's exact version, release date, numeric value, or identity
- **THEN** the tag can appear directly after that entity phrase

#### Scenario: One source supports an entire paragraph
- **WHEN** the same source set supports every material claim in a paragraph
- **THEN** the grouped tags can appear once at the end of that paragraph

#### Scenario: Ordinary nouns appear in grounded prose
- **WHEN** a paragraph contains ordinary entity names that are not separate factual claims
- **THEN** the assistant does not attach redundant tags to every noun

### Requirement: Source tags SHALL open canonical sources safely in a new tab
Each valid source tag SHALL be a keyboard-accessible external link to the ledger's canonical URL, SHALL open in a new tab, and SHALL prevent opener/referrer abuse with `target="_blank"` and `rel="noopener noreferrer"`. Hover and focus SHALL expose the source number, title, domain, and bounded preview.

#### Scenario: User activates a valid source tag
- **WHEN** the user clicks the tag or activates it from the keyboard
- **THEN** the canonical public source opens in a new browser tab without granting the destination access to the originating window

#### Scenario: User inspects a tag without navigating
- **WHEN** the tag receives hover or keyboard focus
- **THEN** the UI shows accessible source metadata and a bounded snippet without fetching the page again

#### Scenario: Several sources support one claim
- **WHEN** a claim has several adjacent valid source markers
- **THEN** the UI displays distinct or grouped tags that each resolve to the correct canonical source

### Requirement: Material external claims SHALL have complete and supportable citations
The answer SHALL cite primary sources near material current or externally verified claims, SHALL distinguish conflicting sources, and SHALL disclose when no source supports a claim.

#### Scenario: Two sources disagree
- **WHEN** retrieved sources materially conflict
- **THEN** the answer identifies the disagreement and cites each relevant source instead of silently choosing one

#### Scenario: Claim lacks support
- **WHEN** no retrieved source supports a requested current fact
- **THEN** the assistant states that the fact could not be verified and does not attach an unrelated citation

### Requirement: Citation quality SHALL be evaluated in separate dimensions
Release validation SHALL measure citation validity, placement, correctness, and completeness separately for GLM-5.2 using deterministic checks plus a fixed reviewed sample.

#### Scenario: Citation URL is valid but irrelevant
- **WHEN** a cited URL was retrieved but does not support the nearby claim
- **THEN** validity can pass while correctness fails, preventing a misleading aggregate pass

#### Scenario: Citation is detached from its claim
- **WHEN** a valid source tag appears only in a distant source list while the supported claim has no nearby marker
- **THEN** citation placement fails even though source validity passes

### Requirement: Fetch usage SHALL be metered and shown separately
Every extraction attempt SHALL create an external-usage record with operation, status, units, returned size, latency, cost, and user price, and the response summary SHALL distinguish search and fetch charges.

#### Scenario: One search and one extract succeed
- **WHEN** a response performs one Basic Search and one Basic Extract
- **THEN** the ledger records two external operations and the user-visible total includes each exactly once
