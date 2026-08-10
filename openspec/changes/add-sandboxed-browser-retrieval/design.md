## Context

Search APIs and managed extraction are the correct default for current programming knowledge: they are cheaper, faster, easier to cite and have a much smaller attack surface than a browser. Some documentation sites, however, render essential text client-side, hide content behind interaction, or require a browser DOM to inspect. If telemetry from the first three changes shows a material unresolved rate attributable to those pages, a constrained browser can close that gap.

The browser must not run in the main `/api/chat` Node.js process with application environment access. Marketplace discovery currently favors Browserbase for hosted browser automation; a custom Playwright path would require Vercel Sandbox or an equivalently ephemeral isolated environment. Implementation must rerun discovery with the current CLI because providers and integration contracts can change.

## Research / ADR Index

- Browser/Sandbox/威胁模型调研：[research/README.md](research/README.md)
- 架构决策记录：[adrs/README.md](adrs/README.md)
- 当前结论是“条件式可选能力”，不是已批准的 provider 采购或实现承诺。

## Goals / Non-Goals

**Goals:**

- Read public, JavaScript-rendered content from an already registered source in an isolated server-side environment.
- Keep network destinations, actions, credentials, duration, resources and cost tightly bounded.
- Return only sanitized evidence and safe metadata to GLM-5.2.
- Make browser use explicit, observable, billable and immediately disableable.

**Non-Goals:**

- No general computer-use agent, arbitrary browsing, search engine navigation or shell.
- No authentication, user cookies, paywall bypass, CAPTCHA bypass, purchases, form submission, uploads or external mutations.
- No downloaded file execution or attachment import.
- No default escalation from every Auto Search response.

## Decisions

### D1. Browser capability is gated by measured need and defaults off

Before implementation, production/evaluation data must identify a recurring supported class where search plus managed extraction fails because JavaScript/interaction hides public text. The feature ships behind an independent kill switch and per-cohort flag. `auto` search alone never grants browser access; policy enables it only for approved source/read goals, with an optional explicit user control.

This avoids paying the cost and security complexity merely for feature completeness.

### D2. Prefer a hosted browser integration; isolate custom Playwright

At apply time, upgrade Vercel CLI, run current `vercel integration discover --category web-automation`, and provision the selected provider before building. If Browserbase remains the leading suitable integration and passes security/cost evaluation, use its ephemeral sessions. If requirements force custom Playwright, execute it in Vercel Sandbox (or equivalent disposable isolated VM/container) with a minimal environment, never inside the chat Function process.

The application server creates tasks and consumes sanitized results; the client and model never receive provider credentials or a raw browser endpoint.

### D3. Expose `browseSource`, not browser primitives

The model tool accepts an opaque registered `sourceId` plus an enum-like read goal from an approved set (for example `rendered_text` or `expand_documentation`). It cannot enter a URL, CSS selector, JavaScript, shell command or arbitrary action sequence. The orchestration layer resolves the source and runs a fixed policy script: navigate, wait within limits, optionally expand safe disclosure widgets, extract main text, and stop.

Any navigation away from the canonical source is denied unless a redirect passes the same public-web validation and origin policy. Popup, new tab, download and cross-origin resource escalation are blocked or ignored.

### D4. Sessions are ephemeral, credentialless and resource-limited

Each task gets a fresh browser context with no application/user cookies, local/session storage, cache, saved passwords, extensions, clipboard or host filesystem mounts. Only provider-scoped short-lived credentials are supplied. Environment variables containing database, auth, LLM, search or payment secrets are absent.

Enforce wall-clock, CPU/memory where available, navigation count, DOM/text size, response byte, screenshot, download and external request limits. Abort propagates from the chat response; all sessions are destroyed on success, error, timeout or client cancellation. Browser service logs follow the retrieval retention policy.

### D5. Network and action policy is deny-by-default

The resolved source must pass the controlled-fetch validator. Egress allows only the target public origin and the minimum static asset origins required to render it, blocks private/reserved addresses after DNS resolution and on every redirect, and forbids non-HTTP(S) protocols. Requests to metadata services, localhost, internal Vercel/app endpoints and arbitrary APIs are blocked.

The browser operates read-only: no click that submits or mutates, no form fill, upload, download, permission prompt acceptance, login or payment. Safe expansion clicks are limited to predeclared semantic patterns and followed by DOM diff checks; uncertainty stops the task.

### D6. Sanitize the result before model context

Return canonical URL, title, bounded visible main text, retrieval timestamp and optional safe screenshot metadata. Strip scripts, hidden controls, forms, event handlers, data URLs and browser/storage details. Full DOM, network trace, console logs and screenshot pixels do not enter model context by default. Page text remains untrusted evidence under the same prompt-injection policy as `readSource`.

### D7. Browser operations have separate budgets, billing and security telemetry

One response may run at most one browser task by default and never more than the configured hard maximum of one in the first release. Admission checks user/global browser allowance and maximum price before creating a session. Meter provider session/runtime/network units, platform cost, user price, latency, termination reason, navigation count, blocked requests and extracted size.

Security alerts cover private-target attempts, cross-origin navigation, downloads, prompt-injection canaries, repeated timeouts and spend spikes. An emergency switch must terminate new admission without disabling ordinary search/fetch.

## Risks / Trade-offs

- **[Browser page escapes to internal network]** → hosted isolation, deny-by-default egress, DNS/redirect validation, no app secrets, fresh sessions.
- **[Page interaction changes external state]** → high-level read goal only, fixed read-only script, no forms/login/payment/download, conservative stop on ambiguity.
- **[Prompt injection becomes more capable]** → browser cannot invent destinations/actions; sanitize output and keep page text below system/user/tool policy.
- **[Latency harms chat UX]** → one task cap, strict deadline, visible “browser reading” state and search/fetch fallback.
- **[Provider/session cost is high]** → measured trigger condition, separate allowance/price, default off and cohort rollout.
- **[Hosted provider availability or privacy concerns]** → adapter boundary, contractual review, minimum retained content and kill switch; custom Sandbox remains an alternative only after design review.

## Migration Plan

1. Produce the coverage-gap report and approve the exact supported browser goals; otherwise leave this change unapplied.
2. Upgrade CLI, rerun Marketplace discovery, provision candidate service, and complete privacy/security review without exposing credentials.
3. Implement task adapter and sandbox policy behind a disabled flag; validate network and resource isolation with a purpose-built test site.
4. Add tool/UI/billing wiring and run malicious redirect, private-IP, prompt injection, download, timeout, cancellation and cost tests.
5. Internal allowlist rollout, then a small cohort. Rollback disables browser admission and preserves search/fetch fallback plus already stored source metadata.

## Open Questions

- The exact provider cannot be frozen before apply-time Marketplace discovery and security review; Browserbase is the current baseline, not an irrevocable dependency.
- Screenshots are excluded from model context in the first release. Add visual extraction only under a separate requirement if rendered text cannot solve the measured cases.
