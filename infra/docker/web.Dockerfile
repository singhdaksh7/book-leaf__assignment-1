# syntax=docker/dockerfile:1
# Static web image. Build context = repository root:  docker build -f infra/docker/web.Dockerfile .
# VITE_API_BASE_URL is intentionally unset: the client defaults to the same-origin relative path /api/v1.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN npm ci --workspace @bookleaf/web --include-workspace-root
RUN npm run build --workspace @bookleaf/contracts && npm run build --workspace @bookleaf/web

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
