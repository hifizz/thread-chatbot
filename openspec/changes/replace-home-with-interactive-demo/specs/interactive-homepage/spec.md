## ADDED Requirements

### Requirement: Interactive scenario homepage
The homepage SHALL present the approved five scenario categories and six scripts, with branching columns, playback controls, feature explanations, and FAQ.

#### Scenario: Explore an example
- **WHEN** a visitor selects a scenario and opens a highlighted question
- **THEN** the corresponding child discussion opens beside its source and can be collapsed and reopened

#### Scenario: Bring conclusions back
- **WHEN** the technical example produces an Artifact and the visitor selects it with @ in the main column
- **THEN** the reference is shown and sending continues the main example with that conclusion

### Requirement: Production entry and isolation
The homepage SHALL retain the existing application entry and legal links, remove repository promotion, and isolate demonstration styling and state.

#### Scenario: Start using the application
- **WHEN** a visitor selects 开始使用
- **THEN** navigation targets the existing start-chat route without submitting a simulated waitlist form

#### Scenario: Leave the homepage
- **WHEN** a visitor navigates to the workbench
- **THEN** landing styles do not change workbench elements or root theme tokens

#### Scenario: Repository link removed
- **WHEN** a visitor reads homepage navigation and footer
- **THEN** no GitHub repository link is displayed
