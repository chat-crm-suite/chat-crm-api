<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/chat-crm-suite/.github/main/brand/svg/chatcrm-lockup-dark.svg">
  <img alt="ChatCRM" src="https://raw.githubusercontent.com/chat-crm-suite/.github/main/brand/svg/chatcrm-lockup-light.svg" width="340">
</picture>

### ChatCRM API

El backend de ChatCRM: conversaciones de WhatsApp que se convierten en clientes.

[![Licencia: PolyForm Noncommercial](https://img.shields.io/badge/licencia-PolyForm%20NC%201.0-006239)](LICENSE)
![Node.js 22](https://img.shields.io/badge/Node.js-22-006239?logo=nodedotjs&logoColor=white)
![NestJS 11](https://img.shields.io/badge/NestJS-11-006239?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-006239?logo=typescript&logoColor=white)
![MySQL 8](https://img.shields.io/badge/MySQL-8-006239?logo=mysql&logoColor=white)
![Redis 7](https://img.shields.io/badge/Redis-7-006239?logo=redis&logoColor=white)

[English](README.md) · **Español**

</div>

---

## Resumen

`chat-crm-api` recibe los mensajes de WhatsApp mediante la **WhatsApp Cloud API**, convierte cada número de
teléfono en un cliente, asigna cada conversación a un miembro del equipo y envía todo a la
[app web](https://github.com/chat-crm-suite/chat-crm-app) en tiempo real. Es uno de los tres servicios de
ChatCRM: ver el [resumen de la organización](https://github.com/chat-crm-suite).

## Funcionalidades

- **WhatsApp Cloud API**: webhooks entrantes firmados (`X-Hub-Signature-256`) y envío de mensajes.
- **Bandeja compartida en tiempo real**: gateway de Socket.IO en el namespace `/chat`.
- **Clientes**: un cliente por identidad, con todo el historial de conversaciones.
- **Asignación automática**: las conversaciones se reparten entre los miembros disponibles de la empresa.
- **Equipos**: empresas, miembros, roles y autenticación con JWT.
- **Métricas**: KPIs mensuales, tendencia mes a mes, ranking de agentes y sentimiento.
- **Análisis de sentimiento**: mediante el servicio opcional [chat-crm-ia](https://github.com/chat-crm-suite/chat-crm-ia).
- **Configuración inicial**: `GET /setup/status` + `POST /setup` crean el administrador, la empresa y el canal de WhatsApp en una sola transacción.
- **Seguridad**: credenciales de los canales cifradas en reposo con AES-256-GCM.
- **Contratos compartidos**: los esquemas Zod de `src/contracts/` validan las peticiones, serializan las respuestas, generan el OpenAPI y la app web los importa.

## Stack

NestJS 11 · TypeORM (MySQL 8) · Redis 7 · BullMQ · Socket.IO · Zod 4 (`nestjs-zod`) · Passport JWT ·
nestjs-i18n · Pino · Swagger/OpenAPI · Jest.

## Inicio rápido

### Docker (recomendado)

Todo el stack (API, app web, MySQL, Redis e IA opcional) se levanta con un solo archivo de Docker Compose
en la carpeta padre que contiene los tres repositorios:

```bash
cp chat-crm-api/.env.example chat-crm-api/.env
(cd chat-crm-api && ./deploy/gen-secrets.sh --env .env)   # rellena los secretos
cp chat-crm-app/.env.example chat-crm-app/.env
docker compose --profile tools up --build -d

curl -s http://localhost:3000/health   # → JSON
```

¿Solo la API? `docker compose up --build -d` dentro de este repositorio (API + MySQL + Redis + phpMyAdmin).

| Servicio | URL |
| --- | --- |
| API | http://localhost:3000 |
| Swagger UI | http://localhost:3000/docs |
| App web | http://localhost:5173 |
| phpMyAdmin (perfil `tools`) | http://localhost:8080 |

### Sin Docker

Requiere Node.js 22, pnpm, MySQL 8 y Redis 7.

```bash
pnpm install
cp .env.example .env        # apunta DB_HOST / REDIS_HOST a tus servicios
pnpm start:dev
```

Las migraciones pendientes de la base de datos se aplican solas al arrancar la API.

## Configuración

| Variable | Descripción |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | Conexión a MySQL |
| `MYSQL_*` | Los mismos valores que `DB_*`, para el contenedor de MySQL (un solo archivo de entorno) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Conexión a Redis (caché y colas) |
| `JWT_SECRET` | Firma los tokens de acceso |
| `CORS_ORIGIN` | Origen de la app web, por ejemplo `http://localhost:5173` |
| `CREDENTIALS_ENCRYPTION_KEY` | Clave AES-256-GCM para las credenciales de los canales (64 caracteres hex o base64 de 32 bytes) |
| `WHATSAPP_APP_SECRET` | App Secret de Meta; verifica la firma de los webhooks |
| `SETUP_TOKEN` | Lo pide la pantalla de configuración inicial en producción |

`./deploy/gen-secrets.sh` rellena todos los secretos con valores aleatorios seguros. Variables opcionales con
valor por defecto: `COOKIE_SECURE`, `SWAGGER_ENABLED`, `IA_URL`, `APP_TZ`, `HEALTH_PROBE_TTL_MS`,
`HEALTH_IA_TIMEOUT_MS`.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `pnpm start:dev` | Servidor de desarrollo con recarga automática |
| `pnpm build` / `pnpm start:prod` | Compilación de producción / ejecuta `dist/main` |
| `pnpm test` · `pnpm test:e2e` · `pnpm test:cov` | Unitarios · end-to-end · cobertura |
| `pnpm lint` · `pnpm format` | ESLint · Prettier |
| `pnpm migration:generate` · `migration:run` · `migration:revert` | Migraciones de TypeORM |
| `pnpm docs:gen` · `pnpm docs:check` | Regenera / verifica `openapi.json` (no necesita MySQL ni Redis) |
| `pnpm db:reset` | Reinicia la base de datos local |

## Estructura del proyecto

```
src/
├── contracts/      Esquemas Zod compartidos con la app web (fuente única de verdad)
├── modules/        setup · users · company · company-members · channels · conversations ·
│                   message · customers · metrics · analysis · notifications · health
├── integrations/   WhatsApp Cloud API (webhooks, clientes, mappers)
├── auth/           Autenticación JWT
├── entities/       Entidades de TypeORM
├── migrations/     Migraciones de la base de datos
├── docs/           Configuración de OpenAPI
└── locales/        Mensajes i18n
docs/               Esquema de la base de datos (DBML) y diseño del tiempo real
test/               Tests end-to-end y de integración
```

## Documentación

- **Referencia de la API**: Swagger UI en `/docs` (activo fuera de producción, o con `SWAGGER_ENABLED=true`) y
  el [`openapi.json`](openapi.json) versionado.
- **Base de datos**: [`docs/database`](docs/database) · **Tiempo real**: [`docs/realtime`](docs/realtime).
- **Despliegue a producción**: [`DEPLOY_PROD.md`](DEPLOY_PROD.md) y [`deploy/`](deploy). Cada despliegue aplica
  las migraciones pendientes: haz antes un respaldo de MySQL.

## Contribuir

Lee la [guía de contribución](https://github.com/chat-crm-suite/.github/blob/main/CONTRIBUTING.md#contribuir-a-chatcrm).
Reporta las vulnerabilidades en privado, como indica la
[política de seguridad](https://github.com/chat-crm-suite/.github/blob/main/SECURITY.md#política-de-seguridad).

## Licencia

Bajo la [PolyForm Noncommercial License 1.0.0](LICENSE):

- **El uso no comercial** es gratuito: usa, modifica y distribuye el código conservando los avisos de copyright ([`NOTICE`](NOTICE)).
- **El uso comercial** requiere una licencia comercial. Las organizaciones con ingresos menores a USD 100.000 al año
  la obtienen gratis; por encima, una cuota anual o un porcentaje de ingresos: ver [`COMMERCIAL.md`](COMMERCIAL.md).
- **Autoría**: `Copyright (c) 2026 Jerremi Aron Chancan Labajos`. El uso comercial exige el crédito visible
  "Built on chat-crm".

Licencias comerciales: **chancanjeremiaron@gmail.com**
