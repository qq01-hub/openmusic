# OpenMusic 部署文档

## 快速开始

### Docker 部署（推荐）

无需克隆源码，直接拉镜像运行：

```bash
# 新部署使用独立宿主机目录；已有部署沿用原目录，迁移前先备份
mkdir -p /opt/openmusic
cd /opt/openmusic

# 下载 compose 文件
curl -O https://raw.githubusercontent.com/qq01-hub/openmusic/main/docker-compose.full.yml
curl -O https://raw.githubusercontent.com/qq01-hub/openmusic/main/.env.full.example

# 生成部署变量并填写全部空值；留空时 Compose 会拒绝启动
[ -f .env ] || cp .env.full.example .env

# 准备持久化目录
mkdir -p data/downloads data/meting
config_files_repaired=0
for config_file in data/.env data/runtimeConfig.json data/adminConfig.json data/setup.lock; do
  if [ -d "$config_file" ]; then
    backup_path="${config_file}.directory-backup-$(date +%Y%m%d%H%M%S)-$$"
    mv -- "$config_file" "$backup_path"
    config_files_repaired=1
    echo "已将异常目录移至 $backup_path 并保留备份。"
  fi
  if [ -e "$config_file" ] && [ ! -f "$config_file" ]; then
    echo "错误: $config_file 不是普通文件，无法安全自动修复。" >&2
    exit 1
  fi
done
[ -f data/.env ] || touch data/.env
[ -f data/setup.lock ] || touch data/setup.lock
[ -f data/runtimeConfig.json ] || printf '{}\n' > data/runtimeConfig.json
[ -f data/adminConfig.json ] || printf '{}\n' > data/adminConfig.json

# 启动（全量版：Redis + Meting + OpenMusic）
if [ "$config_files_repaired" -eq 1 ]; then
  docker compose --env-file .env -f docker-compose.full.yml up -d --force-recreate openmusic
else
  docker compose --env-file .env -f docker-compose.full.yml up -d
fi
```

打开 `http://<IP>:4000`，Redis / Meting 已自动填好，只需填站点域名。完成后自动重启。

Meting 管理后台仅绑定服务器的 `127.0.0.1:${METING_PORT:-3000}`，路径、用户名和首次初始化密码必须在 `.env` 中显式设置。远程管理时执行 `ssh -L 3000:127.0.0.1:3000 user@server`，再从本机浏览器访问；不要直接开放该端口。

> 从旧版全量 Compose 升级时，先按示例补齐根目录 `.env`，否则新版会安全失败而不启动。已有 `ROOM_CREDENTIAL_ENCRYPTION_KEY` 必须原样沿用；Meting 已有数据不会因再次声明初始化变量而被重置。

> 不需要内置 Meting？下载 `docker-compose.yml` 代替。
> 需要统一不同平台的音量基准？再下载 `docker-compose.loudness.yml`，并与全量版一起启动：
> `docker compose --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml pull loudness && docker compose --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml up -d`
> 更新：`docker compose --env-file .env -f docker-compose.full.yml pull && docker compose --env-file .env -f docker-compose.full.yml up -d`
> 宝塔用户：见 [宝塔部署指南](../deploy/DEPLOY-BAOTA.md)，可在 Docker 管理器里直接粘贴 compose。

有源码时也可用一键脚本：`bash deploy/deploy.sh`

无源码时可运行 `curl -fsSL https://raw.githubusercontent.com/qq01-hub/openmusic/main/install.sh | bash`；新部署默认创建 `/opt/openmusic`，也可通过 `OPENMUSIC_DEPLOY_DIR` 指定目录。已有部署先 `cd` 到原目录再执行，脚本会保留原路径、配置和密钥，不自动迁移。以上命令需有目标目录写入权限。

### 源码部署

```bash
npm run install:all
npm run build
npm start   # http://0.0.0.0:4000
```

首次访问自动进入部署向导，填 Redis / Meting / 站点域名即可。向导自动生成密钥、管理员账号密码和 Nginx 配置片段。

> 开发模式：`npm run dev`（前端 `:5173`，后端 `:4000`）

---

## 前置依赖

| 依赖 | 必填 | 说明 |
|------|:----:|------|
| **Redis** | 必需 | 房间、收藏、管理凭据、公告、封禁均只存 Redis |
| **[Meting-API](https://github.com/qq01-hub/Meting-API)** | 必填 | 网易 / QQ 搜索播放、歌词、封面、歌单导入；提供 Docker 镜像 |
| **Meting-API 响度辅助服务** | 可选 | 统一不同平台的 `gain` / `peak` 响度基准；不部署时仍可播放，但平台间音量可能不一致 |
| 七牛 OSS | 可选 | 聊天发图。管理后台填写 |

---

## 环境变量

向导会自动写入 `server/.env`。**业务配置优先用管理后台「运行时配置」**（Meting、注册邮箱 SMTP、OAuth、七牛、歌词、空房 TTL 等），不必改文件。SMTP 密码会以加密形式保存在 `runtimeConfig.json`，生产环境须保留稳定的 `CLIENT_ID_SECRET`，否则保存的密码无法解密。

进程级变量（详见 `server/.env.example`）：

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `PORT` | | 默认 `4000` |
| `NODE_ENV` | 推荐 | 生产设为 `production` |
| `CLIENT_URL` | 生产必填 | 前端 Origin（https） |
| `CLIENT_ID_SECRET` | 生产必填 | 会话签名密钥（向导自动生成） |
| `TRUST_PROXY` | 推荐 | 反代后设为 `1`；仅当 TCP 对端在 `TRUSTED_PROXY_IPS` 中时才采信转发 IP 头 |
| `TRUSTED_PROXY_IPS` | 反代必填 | 逗号分隔的反向代理 TCP 地址；本机 Nginx 默认可用 `127.0.0.1,::1`，容器部署须填网关/代理地址 |
| `CLIENT_IP_HEADER` | 有 CDN | Cloudflare：`CF-Connecting-IP`；EdgeOne：`iqp` |
| `REDIS_URL` | 必需 | Redis 连接串（或分项 `REDIS_HOST` 等） |

生产最小配置示例：

```env
PORT=4000
NODE_ENV=production
CLIENT_URL=https://music.example.com
CLIENT_ID_SECRET=换成一段长随机字符串
TRUST_PROXY=1
TRUSTED_PROXY_IPS=127.0.0.1,::1
REDIS_URL=redis://127.0.0.1:6379/0
```

Meting / 房间凭证密钥等由向导或管理后台配置。使用汽水音乐时，Meting 须包含 `qishui` provider；网易、QQ、汽水均优先房间绑定账号，否则走全站共享池。

---

## Docker 部署细节

- 配置文件挂载到 Compose 所在目录的宿主机 `./data/`（`.env`、`runtimeConfig.json`、`adminConfig.json`、`setup.lock`、`downloads/`），新镜像一键部署对应 `/opt/openmusic/data/`；Meting 数据在其 `meting/` 子目录，容器重建不丢
- Docker 环境下向导自动预填 Redis / Meting，完成后自动重启
- 全量版的 Compose 变量来自仓库根目录 `.env`，应用运行配置仍写入 `./data/.env`，两者用途不同
- 自定义端口：`OPENMUSIC_PORT=8080 docker compose --env-file .env -f docker-compose.full.yml up -d`
- 响度增强版：`docker compose --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml pull loudness && docker compose --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml up -d`；响度服务使用 GHCR `latest` 镜像并仅加入 Docker 内网
- 更新：`git pull && docker compose --env-file .env -f docker-compose.full.yml up -d --build`


### 容器互访与网络迁移

所有 Compose 服务明确加入同一个 `openmusic` 桥接网络，实际名称为 `<项目名>_openmusic`，IPAM 声明子网 `${OPENMUSIC_NETWORK_SUBNET:-172.30.80.0/24}`。不复用独立响度部署的 `openmusic-meting-api-audio-loudness_default` 网络，不固定容器 IP。

| 调用方 | Docker 内网地址 |
|---|---|
| OpenMusic → Redis | `redis://redis:6379/0` |
| OpenMusic → Meting | `http://meting-api:3000` |
| Meting → 响度服务 | `http://meting-api-audio-loudness:3100/analyze` |
| 响度服务 → Redis | `redis://redis:6379` |

`meting-api` 和 `meting-api-audio-loudness` 是同一网络中的显式别名，统一使用全称加端口；Compose 服务键仍保留 `meting` 和 `loudness`，原有日志、更新和依赖命令无需改名。旧短名仍兼容，已有后台保存的地址请在后台更新为表中的完整地址。

OpenMusic 请求层仅在启动环境同时提供 `DOCKER_REDIS_URL`，且 `DOCKER_METING_URL` 指向 `http://meting-api:3000` 或兼容的 `http://meting:3000` 时，允许这些可信服务别名使用 HTTP。其他非本机地址仍要求 HTTPS，不放行任意内网 IP、其他端口或响度服务。标准全量 Compose 已提供所需启动参数；业务音源地址和 API Token 仍通过管理后台配置。更新请求层代码需重新构建或更新 OpenMusic 镜像，仅修改 Compose 或后台地址不足以修复旧镜像的拦截。

这些地址只用于容器间调用，不是浏览器播放地址。浏览器通过本站 `/api/meting` 搜索、取歌词和解析媒体；标准内部封面解析链接转换为本站接口，汽水包装链接转换为本站 `/api/qishui-source`。最终音频必须返回可公开访问的 CDN 地址；类似 `http://meting-api:3000/files/song.mp3` 的非标准内部直链会被清空并返回无可用链接，不能把 Docker 内网开放给浏览器，也不会放宽媒体代理的内网防护。自定义 Meting 实现应返回公网媒体直链或标准解析链接。

响度服务必须通过 `docker compose --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml up -d` 与主服务一起部署；不要单独运行覆盖文件或让面板把它拆成另一个 Compose 项目。安装脚本支持 `OPENMUSIC_ENABLE_LOUDNESS=y`；管道方式安装时从终端读取交互，不读取脚本输入流。

若面板提示“网络创建时未指定子网，无法自定义 IP”，请取消手工指定 IP，使用本项目的新网络，而不是继续选择旧的独立响度默认网络。服务名 DNS 不依赖固定 IP；已有旧网络不会被安装脚本自动删除。以下步骤仅操作本项目，不删除其他项目网络：

1. 备份配置、`data/` 和 Redis 卷，保留原 Compose 项目名。检查 `docker network ls` 和宿主机路由，确认默认子网未重叠；必要时在部署目录 `.env` 设置 `OPENMUSIC_NETWORK_SUBNET=172.29.80.0/24`（只是示例，必须先确认未占用）。这是启动前基础设施配置，不是后台业务配置。
2. 新网络与旧默认网络名称不同，正常更新可直接 `up -d` 重建服务。若需更改已经创建的 `<项目名>_openmusic` 子网，先用相同项目名和完整 `-f` 参数执行 `down`（绝不能加 `-v`），再 `up -d`；Docker 不能直接修改现有网络子网。这会短暂停服，不清空持久化数据。
3. 面板编辑时所有相关服务都应保留 `<项目名>_openmusic` 网络，选择自动分配 IP，不移动到独立响度默认网络。独立响度旧实例验收前不要删除；新实例工作后再自行停用旧实例，避免混淆。
4. 已有后台配置优先于初始化默认值：在 OpenMusic 管理后台将 Meting 音源地址设为 `http://meting-api:3000`，在 Meting 后台“监测设置”将响度地址设为 `http://meting-api-audio-loudness:3100/analyze`。不要使用容器内的 `localhost` 指向其他服务，也不要仅改环境变量后假设旧后台配置已更新。
5. 用 `docker network inspect <项目名>_openmusic` 检查 `IPAM.Config` 和全部服务的接入状态，再验证搜索、播放和响度分析。若升级失败，恢复备份的 Compose 配置，用原项目名重建旧服务；不要删除 Redis 卷。

安装脚本在拉取镜像和启动前校验 Compose 配置，Docker 引擎不可访问时提前停止；启动使用 `up -d --wait --wait-timeout 180` 等待健康检查，并实际检查 OpenMusic → Meting 的 HTTP 连通性，以及启用响度时 Meting → 响度服务的 `/healthz`。Meting 返回认证状态不代表网络不通，API Token 和音乐源权限仍需在后台验证。连通检查失败不会显示部署成功，不自动删除容器或数据。

线上检查命令（Linux 服务器，在原部署目录执行；保留原 Compose 项目名，若原来用 `-p` 则仍需加入）：

```bash
compose=(docker compose --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml)
"${compose[@]}" ps
# 每个服务都应包含同一个 <项目名>_openmusic 网络
for service in openmusic meting loudness redis; do
  container_id="$("${compose[@]}" ps -q "$service")"
  [ -n "$container_id" ] || { echo "缺少运行中的服务: $service"; continue; }
  docker inspect "$container_id" --format '{{.Name}} {{json .NetworkSettings.Networks}}'
done
"${compose[@]}" exec -T openmusic node -e 'fetch("http://meting-api:3000", {signal: AbortSignal.timeout(10000), redirect: "manual"}).then(r => { console.log("Meting HTTP", r.status); process.exit(r.status >= 500 ? 1 : 0); }).catch(e => { console.error(e.message); process.exit(1); })'
"${compose[@]}" exec -T meting node -e 'fetch("http://meting-api-audio-loudness:3100/healthz", {signal: AbortSignal.timeout(10000)}).then(r => { console.log("Loudness HTTP", r.status); process.exit(r.ok ? 0 : 1); }).catch(e => { console.error(e.message); process.exit(1); })'
"${compose[@]}" exec -T redis redis-cli ping
```

未启用响度时去掉第二个 `-f` 参数、`loudness` 和 Meting → 响度检查。另用 `docker network inspect <项目名>_openmusic` 核对子网。以上不能替代搜索、播放、Cookie/API Token、真实音频响度分析和宝塔编辑重建验收；脚本不会自动清理网络、修改已有容器固定 IP 或绕过面板校验。

### 持久化、备份与旧部署迁移

- 宿主机目录与容器内路径不是一回事：`./data/meting:/app/data` 左侧是宿主机目录，右侧才是容器路径。防丢数据靠挂载，不是改目录名字；宿主机 `/root/data` 若已挂载，也不会仅因删除容器而丢失。
- 删除、重建容器或 `docker compose down` 不会删除宿主机 `data/` 和 Redis 命名卷；`docker compose down -v` 会删除 Redis 卷，导致房间、收藏等数据丢失。不要删除数据目录或清理其 Redis 卷。
- 停服备份时保留部署目录 `.env`、整个 `data/`（包括隐藏文件、Meting Cookie 加密密钥）及 Redis 命名卷。仅备份 `data/` 不包含 Redis；先查 `docker inspect "$(docker compose --env-file .env -f docker-compose.full.yml ps -q redis)" --format '{{json .Mounts}}'` 确认实际卷名，再停服备份该卷。备份含凭据，需限制访问权限。
- 从 `/root` 等旧目录迁移到 `/opt/openmusic` 时，先记录原 Compose 项目名（`docker compose ls`）和 Redis 卷名，停止旧服务但不加 `-v`，备份后复制 Compose 文件、`.env` 和完整 `data/` 到未部署过的目标目录。不要覆盖已有部署；原数据与备份保留至验收完成。
- 更换目录会改变默认 Compose 项目名，可能创建空的 Redis 卷。迁移后的每条 Compose 命令必须使用 `-p <原项目名>`，保持原 Redis 卷关联；有响度服务时同时保留覆盖文件和对应 `-f` 参数。原有密钥必须原样沿用，不重新初始化。
- 启动后核对配置挂载路径、Redis 卷名、后台设置、收藏和 Meting Cookie；验证容器重建后仍保留。若失败，停止新目录的服务（不加 `-v`），回原目录用原项目名启动；不要同时运行新旧实例。
- 源码版 `deploy/deploy.sh` 仍在仓库目录创建 `data/`；新部署请将仓库克隆到 `/opt/openmusic` 等独立目录。宝塔示例使用 `/www/openmusic`，不要删除该宿主机目录。

---

## 推荐架构（生产）

| 层级 | 职责 |
|------|------|
| **Nginx** | 直出 `client/dist` 静态资源；仅首页、房间和后台入口回退；HTTPS |
| **Node `:4000`** | 仅承接 `/api/*`、`/socket.io/`、`/downloads/`、`/wx-proxy`、`/cgi-bin/`、SEO 文件 |

**不要** `location / { proxy_pass 4000; }` 全站进 Node。

---

## Nginx 配置

向导完成页会按站点域名生成可复制的 Nginx 配置。仓库内完整示例：

- 宝塔完整版：[deploy/nginx.baota-optimized.conf.example](../deploy/nginx.baota-optimized.conf.example)
- 精简通用版：[deploy/nginx.conf.example](../deploy/nginx.conf.example)

### 必配要点

1. `/socket.io/` 必须 WebSocket 升级
2. `/api/media-proxy` 写在 `/api/` 前面，关闭缓冲
3. `root` 指向 `client/dist`；未知路径须保持 HTTP `404`，并按示例回退到前端 404 页面；仅 `/`、`/room/*`、`/tv/*` 与后台入口可进入应用
4. 有 CDN 时透传 `CLIENT_IP_HEADER`

宝塔详细步骤见 [deploy/DEPLOY-BAOTA.md](../deploy/DEPLOY-BAOTA.md)。

---

## 构建与发版

```bash
npm run build              # 构建前端 → client/dist
npm run package:build      # 交互式录入更新说明，组装 release zip
```

- `forcePrompt: true` = 强制弹窗更新；`false` = 静默发版
- CDN 勿长期缓存 `index.html` 与 `/api/*`

---

## HTTP API 速查

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/setup/status` | 是否需首次部署 |
| `GET` | `/api/app-version` | 前端版本与更新说明 |
| `GET` | `/api/rooms` | 房间列表 |
| `GET` | `/api/rooms/random-match` | 随机匹配一个无需密码、未锁定且有成员在线的公开活跃房间 |
| `POST` | `/api/rooms` | 创建房间 |
| `GET` | `/api/music/toplist/netease` | 网易云热歌榜 |
| `POST` | `/api/music/playlist/import` | 导入歌单 |
| `GET` | `/api/media-proxy?url=` | HTTP 媒体代理 |

WebSocket：`/socket.io`（与 HTTP 同端口）
