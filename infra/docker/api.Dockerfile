# syntax=docker/dockerfile:1
# API image. Build context = repository root:  docker build -f infra/docker/api.Dockerfile .
# The same image runs the server, the Prisma migration job and the synthetic seed job (see infra/docker-compose.yml).
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @bookleaf/api --include-workspace-root
RUN npm run build --workspace @bookleaf/contracts \
    && npm run build --workspace @bookleaf/db \
    && npm run build --workspace @bookleaf/ai \
    && npm run build --workspace @bookleaf/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/attachments && chown -R node:node /data
# Whole workspace: the migrate/seed jobs need the Prisma CLI and tsx (dev dependencies) plus the migration SQL.
COPY --from=build --chown=node:node /repo /repo
# Only the synthetic demo fixture ships in the image; the confidential dataset is excluded by .dockerignore.
COPY --chown=node:node data/synthetic_seed.json ./data/synthetic_seed.json
USER node
WORKDIR /repo/apps/api
ENV PORT=3000 ATTACHMENT_DIR=/data/attachments
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
