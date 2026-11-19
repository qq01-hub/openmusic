# syntax=docker/dockerfile:1

# ---- 前端构建 ----
# Vite 输出为架构无关的静态文件；固定在构建机执行，避免多架构发布时
# 在 QEMU 下为 ARM64 重复执行 npm ci/build。
FROM --platform=$BUILDPLATFORM node:20-alpine AS client-builder
WORKDIR /app
ENV NPM_CONFIG_FETCH_RETRIES=6 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=1000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false
# vite.config.ts 构建期会读取 server/seoFiles.js、scripts/app-version.mjs、release-notes.json
COPY server ./server
COPY scripts ./scripts
COPY vendor/folia ./vendor/folia
COPY docs/FOLIA_IMMERSIVE.md ./docs/FOLIA_IMMERSIVE.md
COPY release-notes.json ./release-notes.json
COPY client/package.json client/package-lock.json* ./client/
RUN --mount=type=cache,id=openmusic-npm-cache,target=/root/.npm,sharing=locked cd client && npm ci --prefer-offline
COPY client ./client
RUN cd client && npm run build

# ---- 后端生产依赖 ----
FROM node:20-alpine AS server-deps
WORKDIR /app/server
ENV NPM_CONFIG_FETCH_RETRIES=6 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=1000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false
COPY server/package.json server/package-lock.json* ./
RUN --mount=type=cache,id=openmusic-npm-cache,target=/root/.npm,sharing=locked npm ci --omit=dev --prefer-offline
COPY deploy/updater/package.json deploy/updater/package-lock.json /app/deploy/updater/
RUN --mount=type=cache,id=openmusic-npm-cache,target=/root/.npm,sharing=locked cd /app/deploy/updater && npm ci --omit=dev --prefer-offline

# ---- 运行时镜像 ----
FROM node:20-alpine AS runtime
ARG OPENMUSIC_RELEASE_VERSION=development
ENV NODE_ENV=production
ENV OPENMUSIC_RELEASE_VERSION=$OPENMUSIC_RELEASE_VERSION
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY deploy/updater ./deploy/updater
COPY --from=server-deps /app/deploy/updater/node_modules ./deploy/updater/node_modules
COPY --from=client-builder /app/client/dist ./client/dist
RUN mkdir -p ./server/downloads

EXPOSE 4000
WORKDIR /app/server
CMD ["node", "index.js"]
