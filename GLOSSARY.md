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

### WhatsApp inbound

The inbound tramo speaks one vocabulary in three layers: provider-raw
**Webhook**, normalized **Inbound Message**, persisted **Conversation
Message**. The provider-prefixed names never leave the intake boundary.

**Webhook**:
The provider-raw WhatsApp payload as it arrives at the intake boundary —
Meta's `whatsapp_business_account` notification — before any translation.
_Avoid_: notification, raw event, payload

**Inbound Message**:
A webhook message translated into our domain but not yet stored: context
(channel id, sender, message id, sender name) plus typed content. Translation
is pure and strict; unknown or invalid messages are discarded, never repaired
with invented defaults.
_Avoid_: parsed message, mapped message, DTO

**Conversation Message**:
The persisted and emitted message that lives in a conversation thread, in
conversation language (room, sender, provider ids).
_Avoid_: chat message, stored message, broadcast

**Inbound Parser**:
The pure, type-keyed translation that turns one raw provider message into
inbound content, or discards it when a required field (media id, non-empty
body, coordinates, …) is missing.
_Avoid_: mapper, handler, switch

**Inbound Router**:
The single type-keyed dispatch that resolves an inbound message to the save
behavior for its content type.
_Avoid_: switch statement, if-else chain

**Fanout**:
The single emission path for conversation content: it delivers an event to the
message's conversation room and to the assignee's personal room, and is
deliberately never company-wide.
_Avoid_: broadcast, emit everywhere

### Team and platform

**Team (Equipo)**:
The members of one company (admin, supervisor, agent), managed from `/team`.
An admin manages anyone; a supervisor only agents and never promotes; nobody
edits their own membership; the last active admin is protected.
_Avoid_: users, staff list, agents (an agent is one role of a member)

**Member removal**:
A soft delete of the membership, never of the account (the person may belong
to other companies). Its open conversations go back to the unassigned queue
with a `release` assignment row and its sessions are revoked. Adding the same
account again restores the same row.
_Avoid_: deactivate, delete user

**Member provisioning**:
The single rule for adding a person to a company: an existing account is
linked by exact email (its password is untouched), otherwise the account is
created with a generated password shown once, a removed membership is
restored, an active one is a conflict.
_Avoid_: invite, signup

**Customer restore**:
Creating, importing or receiving a WhatsApp message from a phone that belongs
to a soft-deleted customer brings that customer back instead of failing on
the unique `(company, phone)`.
_Avoid_: duplicate error, recreate

**Platform console**:
The superadmin area for companies (create, edit, soft delete, restore). It
needs a platform admin account AND an unlock with `PLATFORM_CONSOLE_PASSWORD`;
without that variable the whole surface answers 404.
_Avoid_: admin panel, super admin page
