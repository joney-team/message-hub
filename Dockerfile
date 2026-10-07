# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/joney-team/message-hub" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="Message Hub" \
      org.opencontainers.image.description="Self-hosted embeddable customer chat widget"
ENV NODE_ENV=production \
    PORT=4200 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# Maintenance scripts run inside the container with `docker exec`.
COPY --from=build --chown=node:node /app/scripts/backup.mjs /app/scripts/reset-data.mjs ./scripts/
# The standalone output keeps better-sqlite3 only under .pnpm; expose it so the scripts can import it.
RUN ln -s "$(echo /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3)" /app/node_modules/better-sqlite3
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
