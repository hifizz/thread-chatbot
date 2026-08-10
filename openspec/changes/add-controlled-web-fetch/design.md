## Context

`add-proactive-web-search` deliberately stops at bounded result snippets. That is enough for many current-fact questions, but not for long migration guides, API reference details, changelog context or claims that require reading the original paragraph. The repository already has `readUrl({url})` and Tavily `/extract`, but the current tool accepts arbitrary model-supplied URLs and returns up to 8,000 characters without a response-local source registry, redirect policy, external-usage billing or Thread Chat persistence.

This change only begins after Auto Search is accepted. It adds depth without adding a general browser: the server asks a managed extraction provider to read a source already discovered in the same response, then exposes a bounded text snapshot to GLM-5.2.

## Research / ADR Index

- Fetch/SSRF/prompt-injection/citation/tag 调研：[research/README.md](research/README.md)
- 架构决策记录：[adrs/README.md](adrs/README.md)
- Research 是证据记录，ADR 解释选择，specs 才是规范性契约。

## Goals / Non-Goals

**Goals:**

- Let GLM-5.2 inspect selected primary sources when search snippets are insufficient.
- Eliminate arbitrary-URL tool input by using a response-local source ledger and opaque IDs.
- Treat page content as untrusted, bounded evidence and preserve instruction hierarchy.
- Persist structured sources so citations remain inspectable after reload.
- Meter and cap extract calls independently from search and model tokens.

**Non-Goals:**

- No JavaScript browser execution, login, cookies, form submission, download or external mutation.
- No user-supplied arbitrary URL fetch in the model tool.
- No claim-level automatic fact-checker or guarantee that a cited source is correct.
- No multi-provider routing; that belongs to `harden-web-retrieval-operations`.

## Decisions

### D1. Replace URL input with `readSource({sourceId})`

Every accepted search result is registered in a response-local ledger with an opaque `sourceId`, canonical URL, title, snippet, provider and status. The model sees the ID and descriptive metadata, but the fetch tool schema accepts only `sourceId`. The execute function resolves it from the same request closure; unknown, expired or cross-response IDs fail before any network/provider call.

This is stricter than validating `readUrl({url})`: it prevents the model and prompt-injected page text from inventing a new destination. User-provided URLs can only enter a future flow after a separate server validation and registration step; they are not implicitly trusted.

### D2. Use managed extraction for this phase; no direct app-origin fetch

The server sends the registered public URL to the configured extraction endpoint (initially Tavily `/extract`) and never resolves/fetches the target from the Vercel Function network. Before dispatch, a shared validator requires HTTP(S), rejects credentials, unsafe ports, localhost names, `.local`, IP literals in loopback/private/link-local/reserved ranges and malformed hosts. The returned URL/metadata must still correspond to the registered source.

Managed extraction limits SSRF impact on the application network, but it is not treated as a full browser sandbox. If a future adapter directly follows redirects, it must re-resolve and revalidate every hop, pin the validated address for the connection and enforce an egress allow policy; that implementation is out of scope here.

### D3. One deep read by default, two absolute maximum, with bounded context

GLM-5.2 is instructed to read only when snippets cannot support a necessary claim. A response gets one normal extract unit and an absolute cap of two only when the first source is empty/insufficient or a material conflict needs checking. The shared retrieval budget also accounts for prior search calls so total external requests and user price remain visible.

Each extracted document is limited by provider timeout, response size, allowed content type and a deterministic 6,000-character model-context budget. Boilerplate is removed where the provider supports it; binary, archive, executable and oversized content is rejected. The tool returns title, canonical URL, bounded content, truncation flag and extraction status.

### D4. Page text is wrapped as evidence, never instructions

Tool descriptions and system prompt explicitly say that extracted text may contain malicious instructions and is evidence only. The model must not follow requests inside the page to reveal secrets, change search policy, navigate elsewhere, call tools, download files or contact third parties. Tool output uses structured fields and an untrusted-content delimiter; application secrets, environment variables and internal headers are never included.

### D5. Persist a structured source ledger beside the assistant message

The Thread Chat stream consumer parses validated search and readSource results into a message-owned `sources` collection containing stable ID, title, canonical URL, snippet, whether it was read, and safe display metadata. It never persists full extracted content. Tree sanitization accepts old messages without sources and strips unknown fields.

The model cites with a server-owned inline marker grammar such as `[[cite:<sourceId>]]`, placed immediately after the smallest claim it supports. The renderer resolves a valid marker against the message ledger and displays a compact numbered source tag such as `[1]`; the persisted assistant text keeps the marker so exact placement survives reload. Multiple adjacent markers can support one claim. Unknown/malformed IDs become a visible non-clickable “来源不可验证” state and are logged rather than silently linked.

Placement follows a precision rule: a sentence/claim-end tag is the default; an entity-level tag is allowed when the source supports the entity's exact version, date, value or identity; a paragraph-end tag is allowed only when the same source set supports the paragraph's material claims. The model must not tag every ordinary noun or put all tags only in a detached source list, because both patterns obscure which claim is supported.

Each valid tag is an accessible external link. Hover or keyboard focus shows source number, title, domain and a bounded snippet; activation opens the ledger's canonical URL in a new tab using `target="_blank"` and `rel="noopener noreferrer"`. The UI also renders a compact source list backed by the same ledger. This gives durable, localized provenance without a second LLM verification pass.

### D6. Citation quality is evaluated separately from answer fluency

Tests distinguish citation validity (sourceId resolves), placement (tag is adjacent to the supported entity/claim/paragraph), correctness (source supports the nearby claim) and completeness (material external claims are covered). Deterministic checks enforce ID validity, persistence and safe-link attributes; a fixed GLM-5.2 evaluation set plus sampled human review measures placement/correctness/completeness. The model must cite the most primary available source and disclose conflicts.

### D7. Extraction receives its own external-usage record and price

Each provider extract attempt uses the external-usage ledger introduced by the first change with `operation=extract`, request size, returned characters and status. Tavily's official unit is 1 Basic Extract credit per group of up to five successful URL extractions, and failed extractions are not charged. The implementation therefore records provider-reported usage or reconciled billing when available; because this tool submits one URL per request, a missing-usage provisional estimate MAY conservatively reserve one credit for a successful request and later reconcile it. The response budget and usage summary aggregate model, search and extract without merging their raw units.

## Risks / Trade-offs

- **[A searched malicious domain is still eligible]** → sourceId prevents destination invention; validator blocks unsafe targets; content remains untrusted; no actions or direct app-network fetch occur.
- **[Managed provider hides redirect chain]** → accept only registered sources and returned matching metadata; require a different adapter before any direct fetch use case.
- **[Long documents crowd out conversation context]** → one-read default, 6,000-character cap, deterministic truncation and no full text persistence.
- **[Model cites a source that does not support the claim]** → separate validity/correctness/completeness evaluation, prefer primary sources, surface source list and conflicts.
- **[Persisting sources grows tree rows]** → store only compact metadata/snippets, never extracted body; cap source count per response.
- **[Extract costs surprise users]** → explicit “reading source” activity, hard call cap and separate metering.

## Migration Plan

1. Require `add-proactive-web-search` capability and metrics to be live; keep fetch flag disabled.
2. Add source ledger types and backward-compatible message sanitization before enabling the tool.
3. Add URL safety validator, request-local registry, extract budget and provider adapter tests using fixtures.
4. Wire `readSource` and source stream events, then run malicious-input, persistence, billing and GLM-5.2 citation evals.
5. Enable internally, then percentage-roll out; rollback disables `readSource` while preserving already stored source metadata and search-only behavior.

## Open Questions

- The first rollout uses one read by default; telemetry will decide whether any supported query class deserves two normal reads. The hard maximum remains two.
- The first version uses compact numeric tags with hover/focus previews. Richer side drawers or paragraph highlighting remain optional UI iterations and do not change the persisted sourceId marker contract.
