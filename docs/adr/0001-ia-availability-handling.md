# ADR 0001 — Treat IA unavailability as an expected condition

- Status: Accepted (2026-10)
- Tickets: #18 (spec #11; implemented by #12–#17)
- Code: `src/modules/analysis/**`

## Context

The sentiment analyzer (`IA`) is an in-house service that is still immature: it
exposes a single `/analyze_message` endpoint, it is unstable, and it is
CPU-heavy, so ops keeps it off for long stretches (sometimes days) to save
resources. Today that absence is treated as an incident: every message produces
log errors and analyses marked `failed` with no way to distinguish "not
available" from a real failure, the analysis cannot be turned off on purpose
without touching infrastructure, and the skipped work is lost — nothing retries
it when the IA comes back. The operator wants the benefit while the IA is up,
but its absence must be a non-event: no error noise, no wasted retries, no lost
analyses, and automatic recovery — unless it was turned off deliberately.

## Decision

Treat IA unavailability as an expected system condition, with three coordinated
mechanisms plus an explicit state contract:

- **Manual kill switch** (`ia:enabled` in Redis, read hot on every decision):
  `POST /admin/ia/toggle` turns sentiment analysis off and on in the running
  system, protected by the existing privileged-endpoint guard. Off means zero
  calls, zero health checks and zero retries toward the IA; queued jobs resolve
  as `skipped` with `kill_switch`, and readiness reports `disabled` without
  fetching.
- **Automatic circuit breaker** (state shared in Redis): transport failures
  (timeout, connection refused) or 5xx open the breaker after 5 failures in
  60 s; it stays `open` for 30 s, passes to `half-open` for a single real probe,
  and closes on success or reopens for 60 s on failure. Thresholds are
  environment-configurable with conservative defaults.
- **`skipped` ≠ `failed`**: unavailability skips an analysis with a
  `skipReason` (`kill_switch` | `circuit_breaker` | `ia_unavailable`) and an
  `info` log, without a fabricated neutral sentiment; invalid or
  contract-breaking responses stay `failed` + `error` and do not feed the
  breaker. A skipped analysis emits no `MessageAnalyzedEvent`.
- **Deferred retry**: a worker (every 5 min) re-enqueues skips with reason
  `ia_unavailable` or `circuit_breaker` whose `nextRetryAt` elapsed — reusing
  the same analysis row — only while the kill switch is on and the breaker is
  not `open`. Backoff: 5 m, 15 m, 30 m, 1 h, 2 h, 6 h, 12 h, 24 h; after 8
  attempts it gives up and the analysis stays visible as skipped. `kill_switch`
  and `failed` are never retried.

## Considered options

- **Health-check only** (probe the IA before each analysis). Rejected: a probe
  run between failures still lets calls through, adds a round-trip to every
  analysis, and cannot express the operator's intent of keeping the service off
  for days.
- **Retries only** (no breaker, no kill switch). Rejected: retrying an IA that
  is already known to be off piles up timeouts and noise, and there is still no
  way to stop analysis on purpose.
- **In-memory circuit breaker**. Rejected: state would be per process, reset on
  every deploy, and invisible to other instances and the retry worker; Redis is
  already this project's home for ephemeral/derived state.

## Consequences

- IA unavailability stops being an incident: conversations never block, logs
  stay quiet at `info`, and no one receives fabricated neutral results.
- Redis becomes a runtime dependency for both guards, but its loss fails safe:
  a missing kill switch means analysis is enabled; missing breaker state means
  `closed`. No durable state is at risk — the skip state lives in MySQL.
- A deliberate stop is respected forever: `kill_switch` skips are recorded and
  never auto-retried; recovery debt is exactly the work missed to real
  unavailability.
- Persisting `skipped` + `skipReason` + `retryCount` + `nextRetryAt` needs a
  reversible migration and a read-contract change; `/metrics` exposes the
  counters, the breaker state and the retry backlog.
- The design assumes a single instance today, but the shared Redis state leaves
  the door open to multiple instances without a redesign.
