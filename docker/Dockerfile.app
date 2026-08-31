# syntax=docker/dockerfile:1

# AI Footprint ships as one image: the API serves the built SPA on a single port
# (plan §2.3), so the stack has one service rather than a web/api pair.

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
RUN apt-get update \
 && apt-get install --no-install-recommends -y python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/analytics/package.json packages/analytics/
COPY packages/collectors/package.json packages/collectors/
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
RUN npm run build:packages \
 && npm run build --workspace @ai-footprint/api \
 && npm run build --workspace @ai-footprint/web

# Production dependencies only, rebuilt against the runtime base so the native
# better-sqlite3 binding matches this image's libc (brief §48). The build toolchain is
# purged in the same layer so it never reaches the final image.
FROM node:22-bookworm-slim AS runtime-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/analytics/package.json packages/analytics/
COPY packages/collectors/package.json packages/collectors/
# The web workspace is dropped from the install: its output is static files that the build
# stage already produced, so its toolchain has no business in the runtime image.
RUN node -e "const p=require('./package.json');p.workspaces=['packages/*','apps/api'];require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && apt-get update \
 && apt-get install --no-install-recommends -y python3 make g++ ca-certificates \
 && npm ci --omit=dev --no-audit --no-fund \
 && npm rebuild better-sqlite3 --build-from-source \
 && npm cache clean --force \
 && apt-get purge -y --auto-remove python3 make g++ \
 && rm -rf /var/lib/apt/lists/* /root/.npm

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    AI_FOOTPRINT_MODE=docker \
    AI_FOOTPRINT_HOME=/data \
    AI_FOOTPRINT_PORT=4173
WORKDIR /repo

RUN apt-get update \
 && apt-get install --no-install-recommends -y curl \
 && rm -rf /var/lib/apt/lists/*

# The whole installed layout, not just the hoisted root: npm nests a dependency under its
# own workspace whenever hoisting would conflict, and drizzle-orm lands there.
# Ownership is set during the copy. A separate `chown -R` would duplicate every file into
# a new layer and add hundreds of megabytes to the image.
COPY --from=runtime-deps --chown=node:node /repo ./
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /repo/packages/config/dist ./packages/config/dist
COPY --from=build --chown=node:node /repo/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /repo/packages/analytics/dist ./packages/analytics/dist
COPY --from=build --chown=node:node /repo/packages/collectors/dist ./packages/collectors/dist
COPY --chown=node:node packages/database/migrations ./packages/database/migrations

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 4173

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${AI_FOOTPRINT_PORT}/api/health" || exit 1

CMD ["node", "apps/api/dist/main.js"]
