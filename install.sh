#!/bin/bash
set -euo pipefail

DEPLOY_DIR="${OPENMUSIC_DEPLOY_DIR:-/opt/openmusic}"
COMPOSE_FILE="docker-compose.full.yml"
LOUDNESS_COMPOSE_FILE="docker-compose.loudness.yml"
ENV_FILE=".env"

if [ -z "${OPENMUSIC_DEPLOY_DIR:-}" ] && { [ -e "$COMPOSE_FILE" ] || [ -e data/.env ]; }; then
    DEPLOY_DIR="$(pwd)"
    echo "检测到当前目录已有部署，沿用 $DEPLOY_DIR；迁移前请备份配置、数据及 Redis 卷。"
fi
if ! mkdir -p "$DEPLOY_DIR"; then
    echo "错误: 无法创建部署目录 $DEPLOY_DIR，请使用有写入权限的账号或通过 OPENMUSIC_DEPLOY_DIR 指定目录。" >&2
    exit 1
fi
cd "$DEPLOY_DIR"
echo "部署目录: $DEPLOY_DIR"
echo "宿主机持久化目录: $DEPLOY_DIR/data（删除容器不会删除此目录，请勿手动删除）"

echo "========================================"
echo "  OpenMusic 一键部署"
echo "========================================"
echo ""

enable_loudness="${OPENMUSIC_ENABLE_LOUDNESS:-}"
if [ -z "$enable_loudness" ]; then
    enable_loudness=N
    if [ -t 0 ]; then
        read -r -p "是否部署 Meting-API 响度辅助服务（统一不同平台音量基准）？[y/N] " enable_loudness
    elif [ -r /dev/tty ]; then
        read -r -p "是否部署 Meting-API 响度辅助服务（统一不同平台音量基准）？[y/N] " enable_loudness < /dev/tty || enable_loudness=N
    fi
fi
COMPOSE_FILES=(-f "$COMPOSE_FILE")
if [[ "$enable_loudness" =~ ^[Yy]$ ]]; then
    echo "已选择响度辅助服务，将额外拉取 GHCR 镜像。"
    COMPOSE_FILES+=(-f "$LOUDNESS_COMPOSE_FILE")
else
    echo "未启用响度辅助服务；各平台音量可能存在差异。"
fi

if ! command -v docker &> /dev/null; then
    echo "错误: 未检测到 Docker"
    echo "安装: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo "错误: Docker Compose 不可用"
    exit 1
fi
if ! docker info > /dev/null 2>&1; then
    echo "错误: Docker 引擎不可访问，请先启动 Docker 并确认当前账号权限。" >&2
    exit 1
fi

random_hex() {
    local bytes=$1
    if command -v openssl &> /dev/null; then
        openssl rand -hex "$bytes"
    else
        od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
    fi
}

generate_key() {
    random_hex 32
}

echo "正在下载配置文件..."
tmp_compose="$(mktemp "${COMPOSE_FILE}.tmp.XXXXXX")"
tmp_loudness=""
trap 'rm -f "$tmp_compose"; [ -z "$tmp_loudness" ] || rm -f "$tmp_loudness"' EXIT
curl -fsSL -o "$tmp_compose" https://raw.githubusercontent.com/qq01-hub/openmusic/main/docker-compose.full.yml
mv "$tmp_compose" "$COMPOSE_FILE"
if [[ "$enable_loudness" =~ ^[Yy]$ ]]; then
    tmp_loudness="$(mktemp "${LOUDNESS_COMPOSE_FILE}.tmp.XXXXXX")"
    curl -fsSL -o "$tmp_loudness" https://raw.githubusercontent.com/qq01-hub/openmusic/main/docker-compose.loudness.yml
    mv "$tmp_loudness" "$LOUDNESS_COMPOSE_FILE"
fi

echo ""
echo "正在生成配置..."
if [ ! -f "$ENV_FILE" ]; then
    OPENMUSIC_PORT=4000
    METING_PORT=3000
    METING_ADMIN_PATH="$(random_hex 8)"
    METING_PASSWORD="$(random_hex 16)"
    METING_USERNAME="admin"
    ENCRYPTION_KEY="$(generate_key)"

    cat > "$ENV_FILE" << EOF
OPENMUSIC_PORT=$OPENMUSIC_PORT
METING_PORT=$METING_PORT
OPENMUSIC_NETWORK_SUBNET=${OPENMUSIC_NETWORK_SUBNET:-172.30.80.0/24}
METING_ADMIN_PATH=$METING_ADMIN_PATH
METING_ADMIN_USERNAME=$METING_USERNAME
METING_ADMIN_PASSWORD=$METING_PASSWORD
ROOM_CREDENTIAL_ENCRYPTION_KEY=$ENCRYPTION_KEY
EOF
    echo "已生成新的 .env 配置。"
else
    echo "检测到已有 .env，保留现有配置和密钥。"
    for required_var in METING_ADMIN_PATH METING_ADMIN_USERNAME METING_ADMIN_PASSWORD ROOM_CREDENTIAL_ENCRYPTION_KEY; do
        if ! grep -Eq "^${required_var}=.+$" "$ENV_FILE"; then
            echo "错误: .env 缺少非空配置 ${required_var}，为避免覆盖现有密钥，脚本已停止。" >&2
            exit 1
        fi
    done
fi

echo "正在创建数据目录..."
mkdir -p data/downloads data/meting
config_files_repaired=0
for config_file in data/.env data/setup.lock data/runtimeConfig.json data/adminConfig.json; do
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

echo ""
echo "正在启动 OpenMusic..."
if ! docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" config --quiet; then
    echo "错误: Compose 配置校验失败，未启动或重建容器；请检查 .env 中的凭据和 OPENMUSIC_NETWORK_SUBNET。" >&2
    exit 1
fi
echo "所有服务使用同一项目的 openmusic 网络（显式子网），通过 redis、meting-api、meting-api-audio-loudness 网络名称互访。"
echo "如子网与现有 Docker 网络或宿主机路由冲突，请调整部署目录 .env 的 OPENMUSIC_NETWORK_SUBNET 后重试；不要手动修改容器 IP。"
compose_up_args=(-d --wait --wait-timeout 180)
if [ "$config_files_repaired" -eq 1 ]; then
    compose_up_args+=(--force-recreate)
fi
if docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" pull && docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" up "${compose_up_args[@]}"; then
    echo "正在检查容器间 DNS 和 HTTP 连通性..."
    if ! docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" exec -T openmusic node -e 'fetch("http://meting-api:3000", {signal: AbortSignal.timeout(10000), redirect: "manual"}).then(r => { if (r.status >= 500) throw new Error("Meting HTTP " + r.status); console.log("OpenMusic -> meting-api:3000 OK"); }).catch(e => { console.error(e.message); process.exit(1); })'; then
        echo "错误: OpenMusic 无法访问 Meting，请检查服务网络和日志；配置及数据已保留。" >&2
        exit 1
    fi
    if [[ "$enable_loudness" =~ ^[Yy]$ ]]; then
        if ! docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" exec -T meting node -e 'fetch("http://meting-api-audio-loudness:3100/healthz", {signal: AbortSignal.timeout(10000)}).then(r => { if (!r.ok) throw new Error("响度 HTTP " + r.status); console.log("Meting -> meting-api-audio-loudness:3100 OK"); }).catch(e => { console.error(e.message); process.exit(1); })'; then
            echo "错误: Meting 无法访问响度服务，请检查统一网络和日志；配置及数据已保留。" >&2
            exit 1
        fi
    fi
    echo ""
    echo "========================================"
    echo "  部署成功！"
    echo "========================================"
    echo ""
    echo "访问地址: http://<服务器IP>:4000"
    echo ""
    echo "Meting 管理后台 (仅本机，凭据见 .env):"
    echo "  地址: http://127.0.0.1:3000/<METING_ADMIN_PATH>"
    echo ""
    echo "提示: 首次访问会进入部署向导。"
    echo ""
    echo "常用命令:"
    echo "  先进入部署目录: cd \"$DEPLOY_DIR\""
    echo "  查看日志: docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} logs -f"
    echo "  停止: docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} down"
    echo "  重启: docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} restart"
    echo "  更新: docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} pull && docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} up -d"
    echo "备份时保留部署目录的 .env、data/ 和 Redis 命名卷；不要执行 down -v。"
    echo ""
else
    echo "部署失败，请查看服务状态和日志" >&2
    docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" ps || true
    docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" logs --tail=200 || true
    exit 1
fi
