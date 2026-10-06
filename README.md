<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/chat-crm-suite/.github/main/brand/svg/chatcrm-lockup-dark.svg">
  <img alt="ChatCRM" src="https://raw.githubusercontent.com/chat-crm-suite/.github/main/brand/svg/chatcrm-lockup-light.svg" width="340">
</picture>

### ChatCRM API

The backend of ChatCRM: WhatsApp conversations that turn into customers.

[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20NC%201.0-006239)](LICENSE)
![Node.js 22](https://img.shields.io/badge/Node.js-22-006239?logo=nodedotjs&logoColor=white)
![NestJS 11](https://img.shields.io/badge/NestJS-11-006239?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-006239?logo=typescript&logoColor=white)
![MySQL 8](https://img.shields.io/badge/MySQL-8-006239?logo=mysql&logoColor=white)
![Redis 7](https://img.shields.io/badge/Redis-7-006239?logo=redis&logoColor=white)

**English** · [Español](README.es.md)

</div>

---

## Overview

`chat-crm-api` receives WhatsApp messages through the **WhatsApp Cloud API**, turns every phone number into
a customer, assigns each conversation to a team member and pushes everything to the
[web app](https://github.com/chat-crm-suite/chat-crm-app) in real time. It is one of the three ChatCRM
services — see the [organization overview](https://github.com/chat-crm-suite).

## Features

- **WhatsApp Cloud API** — signed inbound webhooks (`X-Hub-Signature-256`) and outbound messages.
- **Shared inbox in real time** — Socket.IO gateway on the `/chat` namespace.
- **Customers** — one customer per identity, with the full conversation history.
- **Automatic assignment** — conversations are routed to available company members.
- **Teams** — companies, members, roles and JWT authentication.
- **Metrics** — monthly KPIs, month-over-month trends, agent ranking and sentiment.
- **Sentiment analysis** — through the optional [chat-crm-ia](https://github.com/chat-crm-suite/chat-crm-ia) service.
- **First-run setup** — `GET /setup/status` + `POST /setup` create the admin, company and WhatsApp channel in one transaction.
- **Security** — channel credentials encrypted at rest with AES-256-GCM.
- **Shared contracts** — Zod schemas in `src/contracts/` validate requests, serialize responses, generate OpenAPI and are imported by the web app.

## Tech stack

NestJS 11 · TypeORM (MySQL 8) · Redis 7 · BullMQ · Socket.IO · Zod 4 (`nestjs-zod`) · Passport JWT ·
nestjs-i18n · Pino · Swagger/OpenAPI · Jest.

## Quick start

### Docker (recommended)

The whole stack (API, web app, MySQL, Redis, optional AI) runs from one Docker Compose file in the parent
folder that holds the three repositories:

```bash
cp chat-crm-api/.env.example chat-crm-api/.env
(cd chat-crm-api && ./deploy/gen-secrets.sh --env .env)   # fills the secrets
cp chat-crm-app/.env.example chat-crm-app/.env
docker compose --profile tools up --build -d

curl -s http://localhost:3000/health   # → JSON
```

Only the API? `docker compose up --build -d` inside this repository (API + MySQL + Redis + phpMyAdmin).

| Service | URL |
| --- | --- |
| API | http://localhost:3000 |
| Swagger UI | http://localhost:3000/docs |
| Web app | http://localhost:5173 |
| phpMyAdmin (`tools` profile) | http://localhost:8080 |

### Without Docker

Requires Node.js 22, pnpm, MySQL 8 and Redis 7.

```bash
pnpm install
cp .env.example .env        # point DB_HOST / REDIS_HOST to your services
pnpm start:dev
```

Pending database migrations run automatically when the API boots.

## Configuration

| Variable | Description |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | MySQL connection |
| `MYSQL_*` | Same values as `DB_*`, for the MySQL container (one shared env file) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Redis connection (cache and queues) |
| `JWT_SECRET` | Signs access tokens |
| `CORS_ORIGIN` | Web app origin, e.g. `http://localhost:5173` |
| `CREDENTIALS_ENCRYPTION_KEY` | AES-256-GCM key for channel credentials (64 hex chars or base64 of 32 bytes) |
| `WHATSAPP_APP_SECRET` | Meta App Secret; verifies webhook signatures |
| `SETUP_TOKEN` | Required by the first-run setup screen in production |

`./deploy/gen-secrets.sh` fills every secret with a strong random value. Optional variables with defaults:
`COOKIE_SECURE`, `SWAGGER_ENABLED`, `IA_URL`, `APP_TZ`, `HEALTH_PROBE_TTL_MS`, `HEALTH_IA_TIMEOUT_MS`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm start:dev` | Development server with watch mode |
| `pnpm build` / `pnpm start:prod` | Production build / run `dist/main` |
| `pnpm test` · `pnpm test:e2e` · `pnpm test:cov` | Unit · end-to-end · coverage |
| `pnpm lint` · `pnpm format` | ESLint · Prettier |
| `pnpm migration:generate` · `migration:run` · `migration:revert` | TypeORM migrations |
| `pnpm docs:gen` · `pnpm docs:check` | Regenerate / verify `openapi.json` (no MySQL or Redis needed) |
| `pnpm db:reset` | Reset the local database |

## Project structure

```
src/
├── contracts/      Zod schemas shared with the web app (single source of truth)
├── modules/        setup · users · company · company-members · channels · conversations ·
│                   message · customers · metrics · analysis · notifications · health
├── integrations/   WhatsApp Cloud API (webhooks, clients, mappers)
├── auth/           JWT authentication
├── entities/       TypeORM entities
├── migrations/     database migrations
├── docs/           OpenAPI setup
└── locales/        i18n messages
docs/               database schema (DBML) and realtime design
test/               end-to-end and integration tests
```

## Documentation

- **API reference** — Swagger UI at `/docs` (enabled outside production, or with `SWAGGER_ENABLED=true`) and
  the committed [`openapi.json`](openapi.json).
- **Database** — [`docs/database`](docs/database) · **Realtime** — [`docs/realtime`](docs/realtime).
- **Production deploy** — [`DEPLOY_PROD.md`](DEPLOY_PROD.md) and [`deploy/`](deploy). Every deploy applies
  pending migrations: back up MySQL first.

## Contributing

Read the [contributing guide](https://github.com/chat-crm-suite/.github/blob/main/CONTRIBUTING.md). Report
vulnerabilities privately as described in the [security policy](https://github.com/chat-crm-suite/.github/blob/main/SECURITY.md).

## License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE):

- **Noncommercial use** is free: use, modify and distribute the code while keeping the copyright notices ([`NOTICE`](NOTICE)).
- **Commercial use** requires a commercial license. Organizations below USD 100,000/year in revenue get it for free;
  above that, an annual fee or revenue share — see [`COMMERCIAL.md`](COMMERCIAL.md).
- **Authorship**: `Copyright (c) 2026 Jerremi Aron Chancan Labajos`. Commercial use requires the visible credit
  "Built on chat-crm".

Commercial licensing: **chancanjeremiaron@gmail.com**
