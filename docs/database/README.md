# Database schema

MySQL schema for chat-crm: multi-tenant, multi-channel. `schema.dbml` is the same schema as a DBML diagram — paste it into <https://dbdiagram.io/d> to render it.

The runtime DDL is the TypeORM entities (`src/**/entities/*.ts`) and the migrations in `src/migrations/`; the DBML is the human-readable map. Regenerating from the entities must report zero changes — if it doesn't, this map is stale. Domain values are `varchar(50)` columns validated by Zod contracts in `src/contracts/` (single source of truth, shared with the frontend).

## Design rules

- **Tenancy**: every table queryable directly by tenant has `company_id NOT NULL` and its composite indexes start with it. Pure children (`customer_identities`, `customer_tags`, `customer_custom_values`, `customer_notes`, `conversation_reads`, `message_attachments`, `message_status_events`, `sentiment_results`) resolve the tenant through their root.
- **Domain values**: closed sets are `varchar(50)` validated by Zod contracts in `src/contracts/`, so adding a value needs no migration.
- **Identity canon**: `customer_identities` resolves incoming customers (`external_id` stored raw as the channel reports it, so it round-trips to the provider API); `customers.phone_number` is informational and normalized to `+digits` at ingestion; concurrent duplicates are tolerated with read-back; `profile_name` is updated when it changes.
- **Credentials**: `channels.credentials` stores an AES-256-GCM envelope (`iv`, `authTag`, `ciphertext`) with the key in `CREDENTIALS_ENCRYPTION_KEY`; the plaintext keys inside are defined by a Zod schema per channel type.
- **People**: `users` holds identity and login. Any business reference to a staff person (assignee, author, sender, recipient) points to `company_members`, so the role and status always apply in the context of a company.
- **Deletes**: `deleted_at` (soft delete) appears only on business entities. Dependent children use `ON DELETE CASCADE`; other references use explicit `RESTRICT` or `SET NULL`.
- **Channels**: adding a channel means adding a `channel_type` value and a provider adapter in code, without new tables. `customer_identities` and `messages.external_id` carry the provider-side identity for any channel.
- **AI analysis**: every analysis type shares the `analyses` header. A type that needs queryable columns gets a 1:1 detail table (the `sentiment_results` pattern); other types store their output in `result` JSON. `type` is a `varchar`, so a new analysis type needs no migration.
- **Durable vs ephemeral**: MySQL stores durable state; Redis stores ephemeral or derived state, and every derived key can be rebuilt from MySQL. The realtime design lives in [`../realtime/README.md`](../realtime/README.md).
- **IDs**: uuid is stored as `varchar(36)` with UUIDv7 generated app-side (time-ordered); `message_status_events` is the only `bigint` (append-only). If `messages` grows large, `binary(16)` for that table is the documented escape hatch.

## Message lifecycle

- Statuses advance in one direction: `pending < sent < delivered < read`; `failed` always wins. A late `delivered` after `read` is ignored. The current state lives on `messages.status` / `status_updated_at` / `error_code` / `error_message`, and every applied webhook transition is also appended to `message_status_events`.
- MySQL first, sockets after: state is written to MySQL before anything is emitted, so a lost emit is recovered by reloading.
- Idempotency keys: `messages.external_id` (provider wamid, unique per conversation) makes webhook retries a no-op; `client_message_id` (unique per conversation) makes a client resend a no-op.

## Tables

### Tenancy

| Table | What it holds |
|---|---|
| `companies` | Tenant root. |
| `company_settings` | Auto-assignment settings (enabled, max open, sticky, notify supervisors) and business hours; 1:1 with `companies`. |
| `users` | Identity and login only (email, username, password hash, profile). No role or status. |
| `company_members` | A user inside a company; carries `role` (`admin \| supervisor \| agent`) and `status`. Every staff reference points here. |

### Channels

| Table | What it holds |
|---|---|
| `channels` | A provider account (WhatsApp today): encrypted credentials, non-secret settings, webhook verify token; unique `(type, external_account_id)` routes webhooks. |
| `message_templates` | Provider-approved templates (WhatsApp HSM). |

### Customers

| Table | What it holds |
|---|---|
| `customers` | The person you talk to; `phone_number` is informational, resolution goes through identities. |
| `customer_identities` | Resolution canon: `(channel_id, external_id)` → customer. |
| `pipeline_stages` | Configurable sales stages per company. |
| `tags` | Per-company tag catalog. |
| `customer_tags` | Customer ↔ tag join. |
| `custom_field_definitions` | Per-company custom fields (text/number/date/boolean/select/multiselect). |
| `customer_custom_values` | Value of a custom field for a customer. |
| `customer_notes` | Internal notes; never sent to the customer. |

### Inbox

| Table | What it holds |
|---|---|
| `conversations` | A thread between a customer and a channel: status, priority, assignee, last-message pointers and the WhatsApp 24h-window timestamps. |
| `conversation_assignments` | Assignment history (`auto \| claim \| manual \| transfer \| escalation`); the active one has `unassigned_at IS NULL`. |
| `conversation_reads` | Per-member last-read pointer; unread counters are rebuilt from here. |
| `messages` | Every inbound/outbound message: sender, body, provider id (`external_id`), send id (`client_message_id`), status and error fields. |
| `message_attachments` | Files of a message (one message can carry several). |
| `message_status_events` | Append-only delivery history (`bigint`); the current state stays on `messages.status`. |

### AI analysis

| Table | What it holds |
|---|---|
| `analyses` | Common header for every analysis (target, type, model, status, label, `result` JSON). |
| `sentiment_results` | 1:1 detail of a sentiment analysis (label + scores). |

### Notifications

| Table | What it holds |
|---|---|
| `notifications` | Durable notification history for the bell list (`read_at IS NULL` = unread). Realtime delivery, unread badge and dedupe live in Redis. |
