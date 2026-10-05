# Deploy Producción — chat-crm-api (NestJS + MySQL + Redis)

> Tú ejecutas los comandos. Aquí solo están los archivos y el paso a paso.

## 0. Cutover schema v2 (release 1.0.0)

La base es desechable mientras producción se termina de configurar: el corte es **recrear + migración baseline**, sin backfill. En el servidor, con el repo en `main` (release `1.0.0`):

1. Añadir a `.env.prod` (variables nuevas):
   - `CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -hex 32)` — **obligatoria**: sin ella el setup de canales falla al cifrar credenciales.
   - `BOOTSTRAP_COMPANY_NAME=<nombre de la empresa>` — necesaria para que el bootstrap headless cree empresa + member admin + canal (con las `WHATSAPP_*` ya existentes).
2. Backup de MySQL (sección 3 de este documento).
3. Parar la app:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod stop app
   ```
4. Recrear la base (exporta antes `MYSQL_ROOT_PASSWORD` desde `.env.prod`):
   ```bash
   docker exec nestjs-mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" -e \
     "DROP DATABASE IF EXISTS chat_crm_db; CREATE DATABASE chat_crm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   ```
5. Migración explícita (no confiar en `migrationsRun` del arranque; un fallo en boot-loop no diagnostica nada):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod \
     run --rm app node dist/scripts/run-migrations.js
   ```
6. Arrancar:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up --build -d
   ```
7. Verificar:
   ```bash
   curl -s http://localhost:3000/health
   curl -s http://localhost:3000/setup/status   # initialized=true tras el bootstrap
   docker logs nestjs-app --tail 50             # "bootstrap: first admin user created" / "first company created"
   ```
8. Smoke: enviar un webhook simulado (mismo payload de la sección de pruebas) al `WHATSAPP_PHONE_NUMBER_ID` y comprobar en MySQL `customers`, `customer_identities`, `conversations`, `messages`, `conversation_assignments`.
9. Rollback: restaurar el dump (paso 2) + `git reset --hard <commit anterior>` + rebuild (sección 5).

## 1. Qué se corrigió para prod

- `src/app.controller.ts`: agregado `GET /health` → `{status:'ok'}` (lo usa el `HEALTHCHECK` del `Dockerfile`).
- `Dockerfile` (target `production`): ya usa `node dist/main`, usuario `node`, `HEALTHCHECK /health`. Sin cambios.
- `docker-compose.prod.yml`:
  - `app`: quita bind mount, solo `uploads_data:/app/uploads`, `command: !reset`, `NODE_ENV=production`, red `crm-network` + `nestjs-network`.
  - `mysql`: `ports: !override []` (no exponer 3306), `volumes: !override` solo `mysql_data` (quita `./database/init` en prod).
  - `redis`: `ports: !override []`.
  - `phpmyadmin`: solo con `--profile tools` y `127.0.0.1:8080`.
- `.env.prod.example`: plantilla (copiar a `.env.prod` en servidor, NO commitear).
- `.gitignore`: agrega `.env.prod` (hazlo manual si el editor no te deja: una línea con `.env.prod`).

## 2. Flujo local → GitHub → servidor

En tu PC (este repo):

```bash
git add Dockerfile docker-compose.yml docker-compose.prod.yml .env.prod.example src/app.controller.ts DEPLOY_PROD.md
git commit -m "chore(api): prod ready health + compose override"
git push codecta main
# o: git push origin main
```

En el servidor (SSH por Tailscale):

```bash
ssh <USUARIO>@<SERVER_IP>
cd ~/Proyectos/CRM/chat-crm-api
# primera vez:
cp .env.prod.example .env.prod
nano .env.prod   # rellena DB_PASSWORD, DB_ROOT_PASSWORD, REDIS_PASSWORD, JWT_SECRET, CORS_ORIGIN, WHATSAPP_*
# despliegue:
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up --build -d
docker ps
curl -s http://localhost:3000/health
docker logs nestjs-app --tail 50
```

## 3. Backup antes de desplegar (MySQL)

```bash
docker exec nestjs-mysql mysqldump -u root -p"$DB_ROOT_PASSWORD" chat_crm_db | gzip > backup-$(date +%F).sql.gz
```

## 4. Validación

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/ 
docker inspect nestjs-app --format='{{.State.Health.Status}}'
```

## 5. Rollback

```bash
git log --oneline -5
git reset --hard <commit-anterior-bueno>
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up --build -d
```

## 6. Notas red

- `IA_URL=http://chat-crm-ia:8000` resuelve porque `app` e `ia` comparten `crm-network` (nombre fijo `crm-network`).
- `CORS_ORIGIN` debe ser el origen del front, ej. `http://<SERVER_IP>:8081`.
- Si usas HTTPS con reverse proxy: `COOKIE_SECURE=1`.
