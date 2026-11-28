# syntax=docker/dockerfile:1

# 基础镜像 pin 到具体版本 + manifest digest（批 2）：升级 Node 时同步更新版本号与 digest，
# digest 可用 `docker buildx imagetools inspect node:<版本>` 复核
ARG NODE_IMAGE=node:20.19.5-alpine3.22@sha256:6178e78b972f79c335df281f4b7674a2d85071aae2af020ffa39f0a770265435

# ---- 前端构建 ----
# Vite 输出为架构无关的静态文件；固定在构建机执行，避免多架构发布时
# 在 QEMU 下为 ARM64 重复执行 npm ci/build。
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS client-builder
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
# 大资源已外置到仓库根 static/（批 4）；构建时 folia 产物也会由 scripts/build-folia.mjs 搬进 static/
COPY static ./static
RUN cd client && npm run build

# ---- 后端生产依赖 ----
FROM ${NODE_IMAGE} AS server-deps
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
FROM ${NODE_IMAGE} AS runtime
ARG OPENMUSIC_RELEASE_VERSION=development
ENV NODE_ENV=production
ENV OPENMUSIC_RELEASE_VERSION=$OPENMUSIC_RELEASE_VERSION
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY deploy/updater ./deploy/updater
COPY --from=server-deps /app/deploy/updater/node_modules ./deploy/updater/node_modules
COPY --from=client-builder /app/client/dist ./client/dist
# 外置大资源（desk-pet/qface/vendor）：server 按 /desk-pet/、/qface/、/vendor/ 从 ../static 托管
COPY --from=client-builder /app/static ./static
# 运行时以官方镜像内置的非 root 用户 node（uid 1000）运行：
# - 镜像内目录（downloads、临时缓存走 /tmp）归 node 所有，应用可直接写
# - Compose 的 bind 挂载（./data/.env 等宿主机文件）需宿主机侧 chown 到 1000:1000，
#   install.sh 已自动处理；手动部署见 docs/DEPLOY.md「非 root 运行与数据目录权限」
# - updater 服务需访问 docker.sock，是唯一例外：compose 中以 user: "0:0" 覆盖
RUN rm -f ./server/*.test.js && mkdir -p ./server/downloads \
    && chown node:node /app/server \
    && chown -R node:node /app/server/downloads /app/client/dist /app/static
USER node

EXPOSE 4000
WORKDIR /app/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "index.js"]
