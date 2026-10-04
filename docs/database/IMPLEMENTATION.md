# Schema v2 — implementation plan

Execution plan for the redesign described in `README.md` (the "why" and the design live there; this file is the contract for the work). It contains the phases, their verification, the cutover runbook, the acceptance criteria and the roadmap annex for the realtime layer.

**Branch**: `feature/database-schema-v2`, cut from `develop` (git-flow), merged back into `develop`. Creating `release/x.y.z` → `main` + tag is a separate step, done when deploying to production.

**Core premise — the database is disposable.** Production is still being configured; every row can be dropped or recreated. Therefore:

- There is **no data backfill**. The cutover is a big-bang recreate: `DROP DATABASE` → `BaselineV2` → setup.
- The migration history is **squashed into a single `BaselineV2`**; the four legacy migration files are deleted.
- Rollback = restoring the pre-cutover snapshot (or simply recreating). No dual-write, no parallel schema, no negotiated maintenance window.

## Consolidated decisions

| Area | Decision |
|---|---|
| Scope | Data layer only. Redis/realtime layer = Phase 2 (annex; separate branch) |
| API contract | Breaking rename, no compatibility aliases. `chat-crm-app` adapts in the same release train |
| Cutover | Big-bang recreate. Rollback = snapshot/restore |
| IDs | `varchar(36)` + UUIDv7 generated app-side (`@BeforeInsert`). `message_status_events` = `bigint` auto-increment |
| Domain values | `varchar(50)` + zod. `src/contracts/` is the single source of domain values; no legacy aliases (`USER_ROLES`, `USER_STATUSES` are deleted) |
| Dev schema | Real migrations (`migration:generate\|run\|revert`, `db:reset`). `synchronize` only for the sqlite test config |
| Channel credentials | AES-256-GCM JSON envelope (`iv`, `authTag`, `ciphertext`), key in `CREDENTIALS_ENCRYPTION_KEY`. No KMS; key rotation documented as future work |
| Tests | Unit without DB; integration/e2e against MySQL `_test`. sqlite only for non-table concerns |
| Defaults per company | Created by the setup flow: default stages `Nuevo → Lead → Prospecto → Cliente` (`Cliente` won, plus `Perdido` lost), `company_settings`, encrypted channel, admin + `company_members` |
| Tenancy | `company_id` only on tables queryable directly by tenant; pure children (`customer_identities`, `customer_tags`, `customer_custom_values`, `customer_notes`, `conversation_reads`, `message_attachments`, `message_status_events`, `sentiment_results`) resolve the tenant via their root |
| Message external ids | `UNIQUE (conversation_id, external_id)` (the wamid is unique per WhatsApp account, not globally). `client_message_id` keeps `UNIQUE (conversation_id, client_message_id)` |
| Identity canon | `customer_identities` resolves incoming customers; `external_id` stored **raw as the channel reports it** (round-trips to the Graph API); `customers.phone_number` normalized to `+digits` (existing `normalizePhoneNumber`); duplicates tolerated via `isDuplicateEntryError` + re-read; `profile_name` updated on change |
| Legacy role mapping | `members.role` wins over `users.role`; `manager→supervisor`, `support→agent`; `users.role='system'` → `is_platform_admin=true` (no membership). Only relevant if any row survives, which by premise it does not |
| openapi.json | Regenerated at the end of every phase that touches contracts; never hand-edited |

## Phases

### Phase 0 — Plan and docs

Deliverables: this file; `README.md` status update.

- [x] Commit this plan as the first commit of the branch. `docs/` is untracked today, so this commit also brings `README.md` and `schema-v2.dbml` into git.
- [x] `README.md`: status "design only" → implementation started; the line "the next phase is a migration that backfills production data" is replaced by `BaselineV2` + setup (no backfill).

**Verification**: README and this plan do not contradict each other.

### Phase 1 — DBML corrections

Deliverables: `schema-v2.dbml`; `README.md` design rules.

- [x] The 19 DBML enums become `varchar(50)` with a comment pointing at the zod contract that defines their values.
- [x] `messages.external_id`: global UNIQUE → `UNIQUE (conversation_id, external_id)`.
- [x] Tenancy rule rewritten as: every table queryable directly by tenant carries `company_id NOT NULL` and its composite indexes start with it; pure children resolve the tenant through their root.
- [x] Document the credentials envelope and the identity canon (raw `external_id`, `+digits` phone).

**Verification**: render in dbdiagram.io; 25 tables, FKs and indexes match the decisions.

### Phase 2 — Migration infrastructure

Deliverables: `package.json` scripts; `src/config/database.config.ts`.

- [x] npm scripts against `data-source.ts`: `migration:generate`, `migration:run`, `migration:revert`, `db:reset` (drop + run migrations; the idempotent `AdminBootstrapService` provisions setup on next boot).
- [x] Remove `synchronize` from the dev path (it remains only in test configurations until Phase 6).
- [x] Recreate dev databases from scratch.

**Verification**: `db:reset` leaves a usable DB with no `synchronize` anywhere.

### Phase 3 — v2 domain contracts + entities

Deliverables: `src/contracts/*`; entities under `src/modules/**/entities/*` and `src/integrations/**`; credential helper.

- [x] Additive v2 domain contracts first: `member.contract.ts` (`admin|supervisor|agent`), channel types, conversation/message/analysis statuses, pipeline stages. Framework-free (only `zod`).
- [x] The 25 entities per DBML, `varchar` columns typed by the contract unions, no class-validator.
- [x] Abstract base with app-side UUIDv7 PK (`uuidv7()` in `@BeforeInsert`), except `message_status_events`.
- [x] Delete the 13 legacy entities; complete the `src/entities/index.ts` barrel.
- [x] `encryptCredentials`/`decryptCredentials` (AES-256-GCM, IV + authTag).

**Verification**: compiles; entity DDL equals the DBML.

### Phase 4 — BaselineV2

Deliverables: a single baseline migration; legacy migrations deleted.

- [x] Delete the four legacy migration files.
- [x] `BaselineV2` creates the 25 tables + indexes + FKs from an empty DB. No data SQL.

**Verification**: `db:reset` cold → zero divergence between migration and entities.

### Phase 5 — Code adaptation

Deliverables: modules renamed and rewired; contracts migrated.

- [x] Module renames: `contacts`→`customers`, `chats`→`conversations`, `member`→`company_members`, `whatsapp_configs`→`channels`, `analysis`→`analyses`+`sentiment_results`.
- [x] Assignment engine: `company_id` read from `conversations`; the "company not resolved" path dies.
- [x] Raw SQL rewritten: `chat.repository.ts`, `metrics.repository.ts` (fixing the `m.contact_id` reference to a non-existent column), `repositories/sentiment.repository.ts`, `constants/metrics.constants.ts`.
- [x] Customer resolution: webhook → `customer_identities` (raw) → customer; phone → `+digits` via `normalizePhoneNumber`; upsert with `isDuplicateEntryError` + re-read (pattern proven in `contacts.service.ts`).
- [x] `notifications`: `recipient_member_id` + `company_id` + `read_at`; dedupe by `type` + `read_at IS NULL`.
- [x] `users`: drop `role`/`status`, add `is_platform_admin`; remove `online()`/`offline()`; the `users.service.ts:159` query moves to `company_members.status`.
- [x] Contracts: delete `USER_ROLES`/`USER_STATUSES` from `user.contract.ts` and `CONTACT_STATUSES`; create `customer.contract`; rename chat/message contracts. CQRS, gateway and socket events (`chat:*`→`conversation:*`).
- [x] `setup.service.ts`: `company_settings`, default stages, encrypted channel, admin + `company_members`.
- [x] Every commit keeps the build green.

**Verification**: clean `pnpm build`; zero legacy names in `src/`; `openapi.json` regenerated.

### Phase 6 — Tests

- [ ] Rewrite the fishery factories for the new entities.
- [ ] Integration/e2e on MySQL `_test` only; sqlite for non-table concerns.
- [ ] Rewrite `test/assignment.e2e-spec.ts` (critical: assignment engine) and the rest of the specs.

**Verification**: `pnpm test` + `pnpm test:e2e` green on real MySQL.

### Phase 7 — API surface and contract map

- [x] Rename routes/payloads: `/chats`→`/conversations`, `/contacts`→`/customers`, `/whatsapp/config`→`/channels`, etc.
- [x] Rename socket events.
- [x] Contract map (below): the frontend consumes the diff of `src/contracts/` + `openapi.json`; this document adds the route and socket event tables.

**Verification**: every map entry has a counterpart; manual smoke.

## Contract map

> The frontend consumes `src/contracts/` through the `@chat-crm/contracts` alias and `openapi.json` is the generated API surface. This is the human-readable index of the breaking rename; the frontend adaptation branch (`feature/api-v2-adaptation`) must cover 100 % of what `chat-crm-app` consumes.

### HTTP routes

| Old | New |
|---|---|
| `GET/POST /chats`, `/chats/list`, `/chats/unassigned`, `/chats/needs-response`, `/chats/upload`, `/chats/assignments/:chatId`, `/chats/:id/claim`, `/chats/:id/messages` | `/conversations`, `/conversations/list`, `/conversations/unassigned`, `/conversations/needs-response`, `/conversations/upload`, `/conversations/assignments/:conversationId`, `/conversations/:id/claim`, `/conversations/:id/messages` |
| `POST /chats/assign` body `{chatId, agentId}` | `POST /conversations/assign` body `{conversationId, memberId}` (member id, not user id) |
| `GET/POST /contacts`, `/contacts/import`, `/contacts/table`, `/contacts/search`, `/contacts/:phone` | `/customers`, `/customers/import`, `/customers/table`, `/customers/search`, `/customers/:phone` |
| `GET /integration/whatsapp/config`, `GET /integration/whatsapp/config/validate`, `POST /integration/whatsapp`, `PATCH /integration/whatsapp/config` | `GET /channels`, `GET /channels/whatsapp/config`, `GET /channels/whatsapp/config/validate`, `POST /channels`, `PATCH /channels/whatsapp/config` |
| `GET /member/current`, `GET /member/companies` | `GET /company-members/current`, `GET /company-members/companies` |
| `POST /setup` body `whatsapp.{phoneNumberId}` / result `whatsapp` | body `whatsapp.{externalAccountId}` / result `channel` (`{id, webhookVerifyToken}`) |
| `GET /users*` fields: `avatar`, `status`, `role`, `address` | `avatarUrl`, `isPlatformAdmin`, `memberships[]`; `status`/`role`/`address` are gone |
| `GET /auth/me` (user without memberships) | adds `memberships: [{companyId, companyName, role, status}]` |
| `GET /company/me/assignment-settings` field `autoAssignMaxChats` | `autoAssignMaxOpen` |
| `GET /notifications` items `{id,title,message,read,time}` | `{id,title,body,data,readAt,createdAt}` |
| `/metrics/*` | unchanged (query params and response aliases preserved) |
| `/auth/*`, `/health`, `/integration/webhook/whatsapp` | unchanged |

### Socket

Namespace `chat` → `conversation`; rooms: per-conversation room is now `conversation:{id}` (was the raw chat id), `user:{id}` and `company:{id}` unchanged.

| Old event | New event |
|---|---|
| `chat:join`, `chat:joined` | `conversation:join`, `conversation:joined` |
| `chat:message:send`, `chat:message:broadcast`, `chat:message:received`, `chat:message:error` | `conversation:message:send`, `conversation:message:broadcast`, `conversation:message:received`, `conversation:message:error` |
| `chat:sentiment:update` | `conversation:sentiment:update` |
| `chat:assigned`, `chat:unassigned` | `conversation:assigned`, `conversation:unassigned` |
| `new-notification` | `notification:new` |

### Shared contracts

| Old module | New module |
|---|---|
| `contact.contract.ts` | `customer.contract.ts` |
| `chat.contract.ts` + `chats.contract.ts` | `conversation.contract.ts` |
| `whatsapp-config.contract.ts` | `channel.contract.ts` |
| `user.contract.ts` `USER_ROLES`/`USER_STATUSES` | removed; roles live in `member.contract.ts` (`MEMBER_ROLES`) |
| metrics `SentimentLabel` (`POS\|NEU\|NEG`) | `MetricSentimentLabel` (same values); analysis sentiment uses `SentimentLabel` (`positive\|neutral\|negative`) |

Payload renames follow the domain: `chatId`→`conversationId`, `client`→`customer`, `agentId`→`memberId`, `waId`→`externalId` (customer identities), `mediaUrl`→`message_attachments.storage_url`.

## Cutover runbook

1. `mysqldump` of the current DB (rollback reference; disposable but free).
2. `DROP DATABASE` + create empty.
3. Run `pnpm migration:run` explicitly — do **not** rely on `migrationsRun` at boot: a failure inside a boot loop is undiagnosable.
4. Start the new API.
5. Run setup: company + admin + encrypted channel + default stages.
6. Smoke: simulated webhook → message `pending→sent`; auto-assignment from the queue.
7. Deploy `chat-crm-app` (branch `feature/api-v2-adaptation`, opened when this branch closes).
8. **Rollback**: restore the snapshot + previous image.

## Acceptance criteria

- Full suite green (unit + MySQL integration + assignment e2e).
- `BaselineV2` from an empty DB equals the entity DDL.
- Idempotent setup (company + admin + encrypted channel + default stages).
- Simulated ingestion produces `pending→sent` ticks.
- Zero legacy names in `src/` (including raw SQL).
- `openapi.json` regenerated and consistent.
- Frontend typecheck green against the new contracts.
- Contract map covers 100 % of what `chat-crm-app` consumes.

## Annex — Phase 2 (out of scope): realtime layer

Roadmap only; the design lives in the realtime section of `README.md`. Ordered milestones:

1. Redis adapter/emitters for Socket.IO (fan-out is single-process today); rooms joined server-side after JWT validation — **today the gateway trusts `x-user-id`/`x-company-id` from the client; that is fixed here**.
2. Message lifecycle ticks with `client_message_id` idempotency and forward-only status transitions (`pending < sent < delivered < read`, `failed` always wins).
3. Notifications: Redis dedupe (`notif:dedupe:*`) replacing MySQL dedupe, `notif:unread`, `events:{memberId}` streams and `GET /sync` fallback.
4. Derived keys rebuilt from MySQL: `presence:*`, `agent:load:{companyId}`, `queue:unassigned:{companyId}`, `inbox:{companyId}`, `unread:{memberId}`, `typing:*`, `lock:assign:*`, `wa:window:*`.
5. Queues: `chat`, `message`, `analysis`, `notification`.
