# 宝塔面板部署指南

## 方式一：Docker 部署（推荐，最快）

宝塔 → **Docker** → **Compose** → 新建，粘贴以下内容：

```yaml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    networks:
      - openmusic
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  meting:
    image: w3126197382/meting-api:latest
    restart: unless-stopped
    networks:
      openmusic:
        aliases:
          - meting-api
    ports:
      - "3000:3000"
    environment:
      # 管理后台：http://<IP>:3000/admin （仅首次无数据时用下列账号初始化）
      ADMIN_PATH: admin
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: admin123
    volumes:
      - ./data/meting:/app/data
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:3000"]
      interval: 15s
      timeout: 5s
      retries: 3

  openmusic:
    image: w3126197382/openmusic:latest
    restart: unless-stopped
    networks:
      - openmusic
    ports:
      - "4000:4000"
    environment:
      PORT: 4000
      DOCKER_REDIS_URL: redis://redis:6379/0
      DOCKER_METING_URL: http://meting-api:3000
      ROOM_CREDENTIAL_ENCRYPTION_KEY: ${ROOM_CREDENTIAL_ENCRYPTION_KEY:-}
    volumes:
      - type: bind
        source: ./data/.env
        target: /app/server/.env
        bind:
          create_host_path: false
      - type: bind
        source: ./data/runtimeConfig.json
        target: /app/server/runtimeConfig.json
        bind:
          create_host_path: false
      - type: bind
        source: ./data/adminConfig.json
        target: /app/server/adminConfig.json
        bind:
          create_host_path: false
      - type: bind
        source: ./data/setup.lock
        target: /app/server/setup.lock
        bind:
          create_host_path: false
      - ./data/downloads:/app/server/downloads
    depends_on:
      redis:
        condition: service_healthy
      meting:
        condition: service_healthy

volumes:
  redis-data:

networks:
  openmusic:
    driver: bridge
    ipam:
      config:
        - subnet: ${OPENMUSIC_NETWORK_SUBNET:-172.30.80.0/24}
```

所有服务都加入 `<项目名>_openmusic` 网络，已声明子网；面板编辑容器时保留该网络并使用自动分配 IP，不要选择独立响度项目的默认网络。部署响度增强版请使用仓库的全量 Compose 与响度覆盖文件，在同一项目启动，见 [容器互访与网络迁移](../docs/DEPLOY.md#容器互访与网络迁移)。若子网冲突，先确认未占用网段，再设置 `OPENMUSIC_NETWORK_SUBNET`；已创建网络变更子网时需本项目停服重建，不能加 `down -v`。

或者用 SSH 终端：

```bash
# 创建目录并准备持久化文件
mkdir -p /www/openmusic/data/downloads /www/openmusic/data/meting
cd /www/openmusic
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
touch data/.env data/setup.lock
printf '{}\n' > data/runtimeConfig.json
printf '{}\n' > data/adminConfig.json

# 把上面的 yaml 保存为 docker-compose.yml，然后：
if [ "$config_files_repaired" -eq 1 ]; then
  docker compose up -d --force-recreate openmusic
else
  docker compose up -d
fi
```

然后：

1. 打开 `http://<IP>:4000`，Redis 和 Meting 已自动配好，只需填站点域名
2. 点完成，服务自动重启，刷新即可用
3. 如果要配 Nginx 反代 + HTTPS，见下方「Nginx 配置」

### 更新

```bash
cd /www/openmusic
docker compose pull
docker compose up -d
```

### 不需要内置 Meting？

去掉 `meting` 服务和 `DOCKER_METING_URL` 那行，自行准备 Meting 即可。

---

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
cd /www/openmusic/server
npm install --production
cd ..
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup   # 按提示设置开机自启
```

或在宝塔 → **Node 项目** → 添加：运行目录 `/www/openmusic/server`，启动文件 `index.js`，端口 `4000`。

### 3. 完成配置

打开站点，自动进入部署向导，填 Redis / Meting / 域名即可。

### 更新

```bash
# 上传新的 server/ 和 client/dist/ 后：
cd /www/openmusic/server
npm install --production
pm2 restart openmusic
```

---

## Nginx 配置

宝塔 → **网站** → 添加站点 → **设置** → **配置文件**

推荐用部署向导完成页弹出的 Nginx 配置（可一键复制），或对照：
- [nginx.baota-optimized.conf.example](nginx.baota-optimized.conf.example)（完整版）
- [nginx.conf.example](nginx.conf.example)（精简版）

要点：

1. `root` 指向 `client/dist`，**不要** `location / { proxy_pass 4000; }`
2. `/socket.io/` 必须 WebSocket 升级
3. `/api/media-proxy` 写在 `/api/` 前并关闭缓冲
4. HTTPS 在宝塔申请 SSL 即可，反代仍用 `http://127.0.0.1:4000`

保存后：`nginx -t && nginx -s reload`

---

## 常见问题

| 问题 | 处理 |
|------|------|
| 无法加入房间 | 检查 Nginx `/socket.io/` WebSocket 配置 |
| 媒体播放卡顿 | `/api/media-proxy` 加 `proxy_buffering off` |
| 搜不到歌 / 无法播放 | 检查 Meting 配置与 Token |
| 502 | `pm2 list` 或 `docker compose ps` 看服务是否在跑 |
| 端口冲突 | 改 `.env` 的 `PORT` 和 Nginx 反代端口 |
