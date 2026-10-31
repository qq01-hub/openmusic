# syntax=docker/dockerfile:1

# ---- 前端构建 ----
# Vite 输出为架构无关的静态文件；固定在构建机执行，避免多架构发布时
# 在 QEMU 下为 ARM64 重复执行 npm ci/build。
FROM --platform=$BUILDPLATFORM node:20-alpine AS client-builder
WORKDIR /app
# vite.config.ts 构建期会读取 server/seoFiles.js、scripts/app-version.mjs、release-notes.json
COPY server ./server
COPY scripts ./scripts
COPY vendor/folia ./vendor/folia
COPY docs/FOLIA_IMMERSIVE.md ./docs/FOLIA_IMMERSIVE.md
COPY release-notes.json ./release-notes.json
COPY client/package.json client/package-lock.json* ./client/
RUN --mount=type=cache,target=/root/.npm cd client && npm ci
COPY client ./client
RUN cd client && npm run build

# ---- 后端生产依赖 ----
FROM node:20-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---- 运行时镜像 ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=client-builder /app/client/dist ./client/dist
RUN mkdir -p ./server/downloads

EXPOSE 4000
WORKDIR /app/server
CMD ["node", "index.js"]
