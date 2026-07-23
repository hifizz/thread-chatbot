## ADDED Requirements

### Requirement: Product-led English landing page
The public root route `/` SHALL present Thread Chat in English as a product for
branching AI conversations, with “Start chatting” as the primary action and
“View on GitHub” as the secondary action.

#### Scenario: New visitor opens the live site
- **WHEN** a visitor opens `https://thread-chat.zilin.im/`
- **THEN** the first viewport explains the branch-conversation value proposition and exposes both product and GitHub actions with the product action visually primary

### Requirement: Product story explains the interaction
The landing page SHALL explain selection-based branching, inherited context,
return navigation, multi-column comparison, and canvas overview in a coherent
product story.

#### Scenario: Visitor scans the page
- **WHEN** a visitor reads the hero and subsequent showcase sections
- **THEN** they can understand Select → Branch → Navigate and how columns and canvas support comparison and overview

### Requirement: Current capability proof
The landing page SHALL mention only current, product-relevant proof points:
real model responses, persisted conversation trees, Markdown artifacts, and
deep research.

#### Scenario: Visitor evaluates whether the product is functional
- **WHEN** a visitor reaches the capability section
- **THEN** they see concrete implemented capabilities rather than database, billing, provider-pricing, or prototype claims

### Requirement: Research-notebook visual identity
The landing page SHALL use a scoped research-notebook visual system based on
warm paper, ink, text selection, footnotes, annotations, branch connectors, and
depth colors.

#### Scenario: Landing page and workbench are viewed in sequence
- **WHEN** a visitor moves from the landing page into Thread Chat
- **THEN** the two surfaces feel related without landing styles changing the workbench theme

### Requirement: License messaging remains in the repository
The landing page MUST NOT display source-availability, AGPL, commercial-use, or
license messaging.

#### Scenario: Product visitor reads the landing page
- **WHEN** a visitor browses any landing section
- **THEN** licensing details are absent and remain discoverable through the GitHub repository

### Requirement: Static, responsive, and accessible delivery
The landing page SHALL remain server-renderable without a client animation
runtime, preserve semantic heading and link structure, show visible keyboard
focus, respect reduced-motion preferences, and remain readable on small screens.

#### Scenario: Mobile visitor opens the page
- **WHEN** the viewport cannot support desktop side-by-side showcases
- **THEN** sections collapse into a readable single-column order without horizontal page scrolling

#### Scenario: Keyboard user navigates actions
- **WHEN** a visitor tabs through navigation and calls to action
- **THEN** every interactive element has an accessible name and visible focus state
