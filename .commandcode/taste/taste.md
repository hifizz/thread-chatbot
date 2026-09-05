# Taste

## Architecture
- Prefers provider/client instances to be created once and reused across model creation calls, with provider construction kept separate from per-model selection rather than rebuilding the provider inside every `createModel`. Confidence: 0.95

## Communication
- Communicates in Simplified Chinese; respond in Chinese. Confidence: 0.7
- Prefers terse, conclusion-first responses: state the verdict before the reasons and avoid unnecessary exposition; for implementation-location questions, give the exact code or `file:line` directly. Confidence: 0.95
- When asked to react to external reviews (e.g. a GPT critique of its own spec artifacts), first fact-checks the review's claims against the codebase, then delivers a structured verdict — verified-valid points, points held with reservations, plus findings the review missed — and proposes concrete revisions instead of blindly accepting or dismissing. Confidence: 0.8
- Also commissions adversarial re-audits of the assistant's own recent replies, via a second model ("@codex 你来阅读下这最近2条回复看下是否有不对的地方") — so every factual/numeric claim written into replies or artifacts may be re-checked later; on such an audit pass, re-verify each claim against the code (grep counts, file:line evidence, exact numbers not approximations), report findings classified by severity (substantive error vs inconsistency/omission), own mistakes plainly, propose concrete fixes to the artifacts, and apply corrections only after confirmation. Confidence: 0.75
