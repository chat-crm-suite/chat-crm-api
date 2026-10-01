# Base con dependencias del sistema mínimas (bash se mantiene por compatibilidad con compose dev)
FROM node:22-alpine AS base
RUN apk add --no-cache bash
WORKDIR /app

# Desarrollo: dependencias COMPLETAS (incl. devDependencies: @nestjs/cli, jest, eslint)
# y watch con `nest start --watch`. El bind mount tapa /app, así que node_modules vive
# en un volumen del compose con este contenido. uid 1000 = usuario host (WSL).
FROM base AS dev
COPY package*.json ./
RUN npm ci
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# Build: instala todo (incl. devDependencies) y compila a dist/
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Producción: solo dependencias prod + dist compilado, usuario no-root
FROM base AS production
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
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
