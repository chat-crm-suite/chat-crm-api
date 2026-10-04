# Base con dependencias del sistema mínimas (bash se mantiene por compatibilidad con compose dev)
FROM node:22-alpine AS base
RUN apk add --no-cache bash
WORKDIR /app

# Desarrollo: hot-reload (`nest start --watch`) + pnpm store en /pnpm/store.
# El bind mount tapa /app, así que node_modules vive en un volumen del compose
# con este contenido. Todo se crea ya como `node` (chown pequeño ANTES de
# instalar + COPY --chown), así no hay ningún chown -R recursivo posterior que
# reescriba node_modules en cada build.
FROM base AS dev
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV npm_config_store_dir=/pnpm/store
ENV COREPACK_HOME=/pnpm/corepack
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate \
    && mkdir -p /pnpm/store /app \
    && chown -R node:node /pnpm /app
USER node
COPY --chown=node:node package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
EXPOSE 3000
# Sincroniza node_modules con el lockfile en cada arranque: el volumen nombrado
# solo se rellena una vez, así que un rebuild no basta si cambian dependencias.
CMD ["sh", "-c", "pnpm install --frozen-lockfile --prefer-offline && pnpm run start:dev"]

# Build: instala todo (incl. devDependencies) y compila a dist/
FROM base AS build
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Producción: solo dependencias prod + dist compilado, usuario no-root
FROM base AS production
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /app/dist ./dist
# locales/ para nestjs-i18n (la config apunta a <root>/locales, fuera de dist/)
COPY --from=build /app/src/locales ./locales
# uploads/ necesita existir si serve-static lo usa (montado como volumen en prod)
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main"]
