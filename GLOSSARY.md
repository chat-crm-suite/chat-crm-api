# GLOSSARY — Chat CRM API domain vocabulary

Canonical vocabulary for this repo's single context. Code, comments, tests and
docs use these terms; the `_Avoid_` lines mark the synonyms that were settled
out. The spec names the mechanisms in Spanish, but the code identifiers stay
English (`skipped`, `nextRetryAt`, `circuit_breaker`).

## Language

**Kill Switch**:
The operator-controlled, Redis-backed toggle (`ia:enabled`) that turns
sentiment analysis off and on in the running system without a redeploy. While
it is off, no call, probe or retry reaches the IA, and arriving analyses are
recorded as `skipped` with reason `kill_switch`.
_Avoid_: feature flag, enable flag

**Circuit Breaker**:
The automatic guard that stops calling the IA after repeated transport failures
and probes recovery on its own (`closed` → `open` → `half-open`), with its
state shared in Redis so every instance decides alike. A missing state reads as
`closed`.
_Avoid_: retry limit, backoff, throttle

**Análisis omitido (skipped)**:
An analysis deliberately not run because the IA was unavailable (`kill_switch`,
`circuit_breaker` or `ia_unavailable`); it carries a `skipReason` and no
result. It is never a failure: it does not fake a neutral sentiment and emits
no `MessageAnalyzedEvent`.
_Avoid_: failed, neutral, dropped, ignored

**Reintento diferido**:
The scheduled retry that re-enqueues a `skipped` analysis (same row, with
`retryCount` and `nextRetryAt`) once the IA is available again, with backoff up
to 24 h and at most 8 attempts. Only `ia_unavailable` and `circuit_breaker`
skips are retried; `kill_switch` skips never are.
_Avoid_: reprocess, re-run
