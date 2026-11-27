# 宝塔面板部署指南

## 方式一：Docker 一键部署（推荐）

在宝塔的终端运行以下命令，生成的 Compose 项目可在宝塔 Docker 面板中查看

```bash
curl -fsSL https://raw.githubusercontent.com/qq01-hub/openmusic/main/install.sh -o install.sh &&
  OPENMUSIC_DEPLOY_DIR=/www/openmusic bash install.sh
```

1. 已有站点时，先备份并将示例中的 `/www/openmusic` 替换为原 Compose 目录，保留原项目名
2. OpenMusic、Redis、Meting 和 API Token 由脚本自动准备，从本地电脑按脚本输出建立 SSH 隧道，即可打开安装向导
3. 正式上线时在宝塔添加网站并配置 SSL，将网站反向代理到安装器显示的端口：[Docker 镜像上线 HTTPS](../docs/DEPLOY.md#docker-镜像上线-https)

已有外部音源或需要自定义 Compose 时，直接使用仓库的标准文件并按手动部署流程准备持久化文件：[Docker 手动 Compose](../docs/DEPLOY.md#方式二docker-手动-compose)

更新前备份部署目录下的 `.env`、`data/` 和 Redis 命名卷，已接入独立升级服务的部署可从管理后台升级：[系统升级指南](../docs/SYSTEM_UPGRADE.md)

## 方式二：源码部署（PM2）

### 1. 上传文件

把构建好的文件上传到 `/www/openmusic`：

```
/www/openmusic/
├── server/          # Node 后端
├── client/dist/     # 前端（已构建）
└── deploy/          # PM2、Nginx 配置示例
```

### 2. 安装依赖并启动

```bash
cd /www/openmusic
npm ci --prefix server --omit=dev
npm ci --prefix deploy/updater --omit=dev
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
pm2 startup   # 按提示设置开机自启
```

也可由宝塔 **Node 项目** 托管，运行目录为 `/www/openmusic/server`，入口为 `index.js`，默认端口为 `4000`，同一实例只选一种托管方式

源码部署接入本机 Nginx 时，可在 `server/.env` 设置 `HOST=127.0.0.1`

### 3. 完成配置

打开站点，自动进入部署向导，填 Redis / Meting / 域名即可；其余音源、OAuth、SMTP、SEO、AI 等业务项后续直接在 **管理后台 → 运行时配置** 在线修改

### 更新

```bash
# 上传新的 server/ 和 client/dist/ 后：
cd /www/openmusic/server
npm ci --omit=dev
pm2 restart openmusic --update-env
```

---

## Nginx 配置

本节适用于源码或发布包部署，纯镜像安装请使用上面的 Docker 反代步骤

宝塔 → **网站** → 添加站点 → **设置** → **配置文件**

推荐用部署向导完成页弹出的 Nginx 配置（可一键复制），或对照：
- [nginx.baota-optimized.conf.example](nginx.baota-optimized.conf.example)（完整版）
- [nginx.conf.example](nginx.conf.example)（精简版）

要点：

1. `root` 指向 `client/dist`，**不要** `location / { proxy_pass 4000; }`
2. `/socket.io/` 必须 WebSocket 升级
3. `/api/media-proxy` 写在 `/api/` 前并关闭缓冲
4. 定义 `upstream openmusic_backend`（`keepalive 32` + `keepalive_timeout 60s`）并在所有 HTTP 反代块设 `proxy_set_header Connection ""` 复用长连接
5. HTTPS 在宝塔申请 SSL 即可，反代仍走 `http://openmusic_backend`；若未开放 UDP 443 或前置套了免费版 CDN，请勿开启 `listen 443 quic` 与 `Alt-Svc`
6. 使用 `proxy_hide_header` 避免与 Node 重复输出安全头，静态块仅用 `add_header Cache-Control`（不重复写 `expires`），且 `/version.json` 必须设为 `no-cache, must-revalidate`

保存后：`nginx -t && nginx -s reload`

### 音域回响提示 Origin null / CORS 错误

沉浸模式的音域回响在 `sandbox="allow-scripts"` iframe 中运行，资源请求的 Origin 为 `null`。
Node 和部署向导推荐配置已提供所需响应头；Nginx 静态直出不会经过 Node，因此旧站点也需要在实际使用的 `server` 块中补上以下规则（已有同名 location 时更新它，不要重复添加）：

```nginx
location ^~ /vendor/sonic-workshop/ {
    add_header Cache-Control "public, max-age=2592000";
    add_header Access-Control-Allow-Origin "null" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    access_log off;
    try_files $uri =404;
}
```

该规则复用站点指向 `client/dist` 的 `root`，比 `/vendor/` 更长的前缀会优先匹配。
仅对这个公开资源目录设置响应头，不要扩展到 API，也不要添加 `Access-Control-Allow-Credentials` 或移除 iframe 沙箱。

上线：备份当前站点配置，执行 `nginx -t && nginx -s reload`，无需重启 Node、迁移数据或重新构建前端。
若启用了 CDN，刷新 `/vendor/sonic-workshop/` 目录缓存并确认 CDN 保留此响应头；浏览器禁用缓存后刷新页面。
验收时对控制台实际报错的 JS 和 CSS URL 分别执行 `curl -I -H 'Origin: null' 'https://你的域名/实际资源路径'`，确认状态为 200 且包含 `Access-Control-Allow-Origin: null`，再进入音域回响确认场景显示且无 CORS 报错。
若重载后静态资源出现异常，恢复备份配置，重新检查并重载 Nginx；恢复后本 CORS 问题可能再次出现。

---

## 常见问题

| 问题 | 处理 |
|------|------|
| 无法加入房间 | 检查 Nginx `/socket.io/` WebSocket 配置 |
| 媒体播放卡顿 | `/api/media-proxy` 加 `proxy_buffering off` 与 `gzip off` |
| HTTPS 登录后立即 401 | 核对 Nginx 透传 `X-Forwarded-Proto $scheme`、`.env` 的 `TRUST_PROXY=1` 与 `TRUSTED_PROXY_IPS`，上线 HTTPS 后将 `ALLOW_INSECURE_COOKIES` 设为 `0` 并重建容器 |
| 上传封面或图片报 413 | 在 Nginx `server` 块补齐 `client_max_body_size 20m;` 并重载 |
| 搜不到歌 / 无法播放 | 检查 Meting 配置与 Token |
| 502 | `pm2 list` 或 `docker compose ps` 看服务是否在跑 |
| 端口冲突 | Docker 调整部署目录的 `OPENMUSIC_PORT`，源码调整 `server/.env` 的 `PORT`，再同步反代端口 |
| Redis 在数据库页没有显示 | Docker Redis 由 Compose 托管，可用原 Compose 参数运行 `ps redis` 或 `exec -T redis redis-cli ping` 查看 |
