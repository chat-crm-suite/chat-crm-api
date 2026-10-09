# Logging — format, fields and levels

Contract for application logs: what each line looks like, which fields correlate a request or an
analysis, and at which level something is logged. Runtime configuration lives in
[`src/config/logger.config.ts`](../../src/config/logger.config.ts); this document is binding for new
logs (feature tickets T1–T4 of the sentiment spec follow it).

## 1. Formats

| Environment | Default output | Threshold |
| --- | --- | --- |
| development | `pino-pretty`, one colorized line per log | `debug` |
| production | one JSON object per line (NDJSON), no color | `info` |

Pretty output is never the production default. `LOG_PRETTY` is the debugging escape hatch:

- `LOG_PRETTY=true` — force pretty anywhere (e.g. to debug a production issue by hand).
- `LOG_PRETTY=false` — force JSON anywhere (e.g. to inspect the production shape locally).
- unset — the defaults above.

`pino-pretty` is a runtime dependency so the escape hatch also works in the production image.

## 2. JSON line shape (production)

```
{"level":30,"time":1791390767604,"pid":15656,"hostname":"api-1","context":"SentimentService","analysisId":"ana_01H...","messageId":"msg_01H...","durationMs":142,"msg":"analysis completed"}
```

Fields, in the order they appear:

1. `level` (number) and `time` (epoch ms), emitted by pino.
2. `pid` and `hostname`: pino base bindings; they identify the container/process.
3. HTTP request lines: `pino-http` binds `req` and the `http` shorthand (`[url, method, statusCode]`)
   before the log object, and puts `res` / `responseTime` inside it.
4. The correlation fields, always in this canonical order when present:
   `context`, `analysisId`, `messageId`, `attachmentId`, `mediaId`, `type`, `conversationId`, `durationMs`, `reason`.
5. Any other fields in the order the call site passed them (e.g. `err`, `responseTime`).
6. `msg` last.

The formatter only reorders: it never drops or renames fields, and unknown fields keep their call-site
order. A line is one object terminated by `\n`, so `jq`/log shippers parse it without configuration.

## 3. Field conventions

| Field | Type | Meaning |
| --- | --- | --- |
| `context` | string | Class/service that owns the log (`PinoLogger.setContext`). |
| `analysisId` | string | `analyses.id` — **the trace**: include it in every log about an analysis, from enqueue to completion, skip or retry. |
| `messageId` | string | `messages.id` of the message under analysis. |
| `attachmentId` | string | Inbound attachment id, correlated with its enrichment log. |
| `mediaId` | string | Provider media id (retry key), correlated with its enrichment log. |
| `type` | string | Inbound message/attachment type (e.g. `text`, `image`, `order`). |
| `conversationId` | string | `conversations.id` the message belongs to. |
| `durationMs` | number | Elapsed milliseconds of the measured operation (e.g. the IA HTTP call). |
| `reason` | string | Why an analysis was skipped: `kill_switch` \| `circuit_breaker` \| `ia_unavailable`. |
| `err` | object | Error serialized by pino (`type`, `message`, `stack`). Pass `{ err }`, never `err.message` alone. |

To follow one analysis end to end, search by `analysisId`; to widen to the thread, use `messageId` or
`conversationId`.

## 4. Level policy

| Level | Use it for | Examples |
| --- | --- | --- |
| `debug` | Step detail useful while developing; hidden in production (threshold `info`). | Decision branches, loaded payload shapes, cache hits. |
| `info` | Expected lifecycle events and **expected unavailability** — never an error. | Analysis completed (`durationMs`), analysis skipped (`reason`), circuit breaker transitions, kill switch toggles, retry scheduled. |
| `warn` | Unexpected but handled degradation. | Missing `conversationId`/`companyId` or empty content for an analysis payload. |
| `error` | Real failures worth investigating. **Never** expected unavailability. | Invalid/unexpected IA response (broken contract), persistence failures, unhandled rejections and uncaught exceptions. |

Rule of thumb: if the current design already accepts the condition (the IA is known to be off or
unreachable), it is `info`/`debug`; if it means a bug or a broken contract, it is `error`.

## 5. Startup safety nets

`src/main.ts` registers the `unhandledRejection` and `uncaughtException` handlers through the same pino
configuration (`context: "Bootstrap"`) from the first line of `bootstrap()`, so nothing in the server
startup path writes with `console.*`.
