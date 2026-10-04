# Database schema v2 (proposal)

`schema-v2.dbml` is the proposed redesign of the chat-crm MySQL schema. Paste it into <https://dbdiagram.io/d> to render it.

Status: **implementation started** on `feature/database-schema-v2`. See `IMPLEMENTATION.md` for the execution plan (phases, cutover runbook, acceptance criteria).

The database is disposable while production is being configured, so there is **no data backfill**: the cutover is a recreate plus a single `BaselineV2` migration, and the legacy migration history is squashed.

## Why

| # | Current problem | Consequence | v2 fix |
|---|---|---|---|
| 1 | `chats` has no `company_id`; the tenant is derived via `contact.company` (nullable, `SET NULL`) | cross-tenant leaks; the assignment engine logs "company not resolved" | `company_id NOT NULL` on every business table |
| 2 | `contacts.wa_id` is globally UNIQUE | the same person cannot message two companies | `customer_identities (channel_id, external_id)` unique per channel |
| 3 | `users.role` (admin/supervisor/support/agent/system) **and** `members.role` (admin/agent/manager) | two incompatible sources of truth | one role per company in `company_members.role` (`admin \| supervisor \| agent`); `users.is_platform_admin` for the SaaS superadmin |
| 4 | `chat_assignments` has `UNIQUE(chat, agent)`, plus a parallel `transfers` table | the same agent cannot be reassigned; history is duplicated | a single `conversation_assignments` history table with `reason` |
| 5 | `messages.sender_id` is polymorphic with no FK; `messages.chat` is nullable with `SET NULL` | orphan messages; the sender cannot be verified | `sender_member_id` / `sender_customer_id` FKs; `conversation_id NOT NULL` |
| 6 | eager circular FK `chats.last_message_id` | an extra join on every chat query | kept for the inbox list, but not eager |
| 7 | `whatsapp_message_details` exists only to hold `wa_id` | an extra table coupled to WhatsApp | `messages.external_id` |
| 8 | `whatsapp_configs.phone_number_id` is not unique; the access token is stored in plain text | ambiguous webhook routing; security risk | `channels (type, external_account_id)` unique; `credentials` JSON encrypted at app level |
| 9 | `contacts.tags` is a `simple-array`; the `ContactStatus` type and enum disagree | tags cannot be filtered or indexed; statuses are inconsistent | `tags` + `customer_tags`; `pipeline_stages` |
| 10 | `users.status` (online/busy) is stored in MySQL | realtime presence load on the relational DB | Redis (see below) |
| 11 | mixed PKs (`message_id`, `analysis_id`, `id`, `int`) | inconsistent | `id uuid` everywhere (except `message_status_events`, an append-only `bigint` table) |
| 12 | names don't match the domain (`contacts`, `chats`, `members`) | cognitive load | `customers`, `conversations`, `company_members`, `channels` |

## Old → new mapping

| Old | New |
|---|---|
| `companies.auto_assign_*` | `company_settings` (1:1) |
| `members` | `company_members` |
| `users.role` / `users.status` | `company_members.role` / Redis presence |
| `whatsapp_configs` | `channels` (`type = whatsapp`) |
| `contacts` | `customers` |
| `contacts.wa_id` | `customer_identities.external_id` |
| `contacts.tags` | `tags` + `customer_tags` |
| `contacts.status` | `customers.pipeline_stage_id` → `pipeline_stages` |
| `chats` | `conversations` (+ `company_id`, `channel_id`, `assigned_member_id`, `last_inbound_at`) |
| `chats.channel` (enum) | `conversations.channel_id` → `channels` |
| `chat_assignments` + `transfers` | `conversation_assignments` |
| `messages.sender_id` | `messages.sender_member_id` / `messages.sender_customer_id` |
| `messages.media_url` | `message_attachments` |
| `whatsapp_message_details.wa_id` | `messages.external_id` |
| `analysis` | `analyses` (target = message or conversation) |
| `sentiment_analysis` | `sentiment_results` (1:1 detail of `analyses`) |
| `notifications.user_id`, `read` | `notifications.recipient_member_id` + `company_id`, `read_at` |

New tables: `customer_identities`, `pipeline_stages`, `tags`, `customer_tags`, `custom_field_definitions`, `customer_custom_values`, `customer_notes`, `conversation_reads`, `message_attachments`, `message_status_events`, `message_templates`.

## Design rules

- **Tenancy**: every business table has `company_id NOT NULL`, and its composite indexes start with it.
- **People**: `users` holds identity and login. Any business reference to a staff person (assignee, author, sender, recipient) points to `company_members`, so the role and status always apply in the context of a company.
- **Deletes**: `deleted_at` (soft delete) appears only on business entities. Dependent children use `ON DELETE CASCADE`; other references use explicit `RESTRICT` or `SET NULL`.
- **Channels**: adding a channel means adding a `channel_type` value and a provider adapter in code, without new tables. `customer_identities` and `messages.external_id` replace the WhatsApp-specific `wa_id`.
- **AI analysis**: every analysis type shares the `analyses` header. A type that needs queryable columns gets a 1:1 detail table (the `sentiment_results` pattern); other types store their output in `result` JSON. `type` is a `varchar`, so adding a new analysis type needs no migration.
- **Durable vs ephemeral**: MySQL stores durable state. Redis stores ephemeral or derived state, and every derived key can be rebuilt from MySQL.
- **IDs**: uuid is stored as `char(36)` (the TypeORM default). If `messages` grows large, consider UUIDv7 or `binary(16)` for better index locality.


## Realtime layer (Redis)

Goal: WhatsApp-like UX. Messages, delivery ticks, typing, assignments and notifications appear instantly, survive short disconnects, and work with several API/worker processes.

Each layer has one job:

| Layer | Job | Lost if Redis restarts? |
|---|---|---|
| MySQL | durable truth: messages, statuses, notifications history, reads | no |
| Redis Streams | short-lived **replay log** per member, so a reconnecting client gets what it missed | yes (rebuilt from MySQL via `/sync`) |
| Redis pub/sub (Socket.IO adapter) | **fan-out** of events to every API instance / worker | yes (fire-and-forget) |
| Redis keys (HASH/ZSET/STRING) | fast counters, presence, locks, dedupe | yes (rebuilt from MySQL) |

### 1. Transport: Socket.IO Redis adapter

- Install `@socket.io/redis-adapter` on the API and `@socket.io/redis-emitter` in BullMQ workers. Any process can then `emit` to any room, and the event reaches every connected client.
- Rooms (joined server-side on connect, **after validating the JWT**; never trust `x-user-id` / `x-company-id` sent by the client):

| Room | Who joins | Used for |
|---|---|---|
| `member:{memberId}` | each socket of that member | notifications, assignments, unread badge |
| `company:{companyId}` | every member of the company | inbox list updates, queue changes |
| `supervisors:{companyId}` | admin + supervisor | unassigned-queue alerts, live agent load |
| `conversation:{conversationId}` | sockets with that chat open | new messages, ticks, typing |

### 2. Message lifecycle (the ticks)

```
front                         API / worker                          WhatsApp
  | send {client_message_id}     |                                      |
  |----------------------------->| INSERT messages(status=pending)      |
  |<-- ack {id, pending}  🕓     | enqueue BullMQ `message`             |
  |                              |------------- POST /messages -------->|
  |<-- message:status sent  ✓    | UPDATE status=sent, external_id=wamid|
  |                              |<----------- webhook delivered -------|
  |<-- message:status delivered ✓✓ UPDATE + INSERT message_status_events|
  |                              |<----------- webhook read ------------|
  |<-- message:status read  ✓✓(blue)                                    |
```

- `client_message_id` (generated by the front) makes retries idempotent: a resend after a reconnect hits `UNIQUE(conversation_id, client_message_id)` and returns the existing row.
- Inbound customer message: webhook → queue `chat` → INSERT → emit `message:new` to `conversation:{id}` + `conversation:updated` to `company:{companyId}` (inbox reorder) → `HINCRBY unread:{memberId}` for the assignee → emit `unread:updated` to `member:{memberId}`.
- Status regressions are ignored (a late `delivered` after `read` must not downgrade the tick): only move forward in `pending < sent < delivered < read`; `failed` always wins.

### 3. Notifications (realtime + durable)

```
event (assigned, unassigned queue, mention, SLA breach...)
  ├─ SET notif:dedupe:{memberId}:{type}:{conversationId} 1 NX EX 600   -> already set? stop
  ├─ INSERT notifications (MySQL, history for the bell list)
  ├─ INCR notif:unread:{memberId}
  ├─ XADD events:{memberId} MAXLEN ~ 500 * type notification data {...}
  └─ emit `notification:new` to member:{memberId}
```

- The dedupe key replaces the current `hasUnreadByTitle` query on every alert.
- Mark as read: `UPDATE notifications SET read_at` + `DECR`/`SET notif:unread:{memberId}` + emit `notification:read` (syncs other open tabs).
- Member offline (no `presence:hb`): the event is still stored; later this is where web push / email would plug in.

### 4. Reconnect and sync (no lost events)

1. Every event emitted to a member is also `XADD`-ed to `events:{memberId}` (capped, ~500 entries, plus a TTL of a few hours).
2. The front keeps the last stream id it saw. On reconnect it sends `sync { lastEventId }`.
3. The server replays with `XRANGE events:{memberId} (lastEventId +`.
4. If `lastEventId` is too old (trimmed) or Redis was flushed, the front falls back to REST: `GET /sync?since=<timestamp>`, served from MySQL (`messages.updated_at`, `notifications.created_at`).

### 5. Key map

| Key | Type | Purpose | Rebuild from |
|---|---|---|---|
| `presence:{companyId}` | HASH `memberId → online \| busy \| away` | live status for the UI and the assignment engine | socket connect/disconnect |
| `presence:hb:{memberId}` | STRING, TTL 60s | heartbeat; expiry = offline | socket ping |
| `presence:sockets:{memberId}` | SET of socket ids | multi-tab: offline only when the last socket leaves | socket connect/disconnect |
| `agent:load:{companyId}` | ZSET `memberId → open assigned count` | least-loaded agent without `COUNT(*)` | `conversations.assigned_member_id` |
| `queue:unassigned:{companyId}` | ZSET `conversationId → waiting_since` | claim queue | `conversations` where `assigned_member_id IS NULL` |
| `inbox:{companyId}` | ZSET `conversationId → last_message_at` | inbox ordering without hitting MySQL | `conversations.last_message_at` |
| `unread:{memberId}` | HASH `conversationId → count` | per-chat unread badges | `conversation_reads` + `messages` |
| `notif:unread:{memberId}` | STRING counter | bell badge | `notifications WHERE read_at IS NULL` |
| `notif:dedupe:{memberId}:{type}:{ref}` | STRING, NX + TTL | avoid notification spam | ephemeral |
| `events:{memberId}` | STREAM, MAXLEN ~500 | replay missed events on reconnect | MySQL via `/sync` |
| `typing:{conversationId}:{memberId}` | STRING, TTL 5s | "typing…" indicator (emit only, never stored in MySQL) | ephemeral |
| `lock:assign:{conversationId}` | `SET NX PX 5000` | prevent a double claim or assignment | ephemeral |
| `wa:window:{conversationId}` | STRING, TTL = 24h from the last inbound | WA 24h free-text window check | `conversations.last_inbound_at` |
| BullMQ `chat`, `message`, `analysis`, `notification` | queues | ingestion, sending, AI, notification fan-out | — |

### 6. Socket events (server → client)

| Event | Room | Payload |
|---|---|---|
| `message:new` | `conversation:{id}` | message |
| `message:status` | `conversation:{id}` | `{ id, clientMessageId, status, at }` |
| `conversation:updated` | `company:{companyId}` | `{ id, lastMessage, lastMessageAt, status, assignedMemberId }` |
| `conversation:assigned` / `conversation:unassigned` | `member:{id}`, `supervisors:{companyId}` | `{ conversationId, memberId }` |
| `typing` | `conversation:{id}` | `{ conversationId, memberId \| customer, isTyping }` |
| `unread:updated` | `member:{id}` | `{ conversationId, count }` |
| `notification:new` / `notification:read` | `member:{id}` | notification / `{ id }` |
| `presence:updated` | `company:{companyId}` | `{ memberId, status }` |
| `sentiment:updated` | `conversation:{id}` | analysis result |

Rule: **write MySQL first, then Redis, then emit.** If the emit is lost, the stream or `/sync` recovers it. If Redis is lost, every key above can be rebuilt from MySQL.
