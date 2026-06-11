# Backend: Fastify + better-sqlite3 + sharp. Multi-stage: build TS → slim runtime.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Build deps for native modules (better-sqlite3, sharp) during npm ci.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# sharp needs libvips at runtime; the prebuilt binary bundles it, but keep certs.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Data dir is a mounted volume; created at runtime by ensureDirs().
ENV DATA_DIR=/data
EXPOSE 4000
CMD ["node", "dist/server.js"]
