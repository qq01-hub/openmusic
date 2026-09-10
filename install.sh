#!/bin/bash
set -euo pipefail

DEPLOY_DIR="$(pwd)"
COMPOSE_FILE="docker-compose.full.yml"
ENV_FILE=".env"

cd "$DEPLOY_DIR"
echo "部署目录: $DEPLOY_DIR"

echo "========================================"
echo "  OpenMusic 一键部署"
echo "========================================"
echo ""

if ! command -v docker &> /dev/null; then
    echo "错误: 未检测到 Docker"
    echo "安装: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo "错误: Docker Compose 不可用"
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
trap 'rm -f "$tmp_compose"' EXIT
curl -fsSL -o "$tmp_compose" https://raw.githubusercontent.com/qq01-hub/openmusic/main/docker-compose.full.yml
mv "$tmp_compose" "$COMPOSE_FILE"

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
[ -e data/.env ] || touch data/.env
[ -e data/setup.lock ] || touch data/setup.lock
[ -e data/runtimeConfig.json ] || printf '{}\n' > data/runtimeConfig.json
[ -e data/adminConfig.json ] || printf '{}\n' > data/adminConfig.json

echo ""
echo "正在启动 OpenMusic..."
if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d; then
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
    echo "  查看日志: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs -f"
    echo "  停止: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE down"
    echo "  重启: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE restart"
    echo "  更新: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE pull && docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d"
    echo ""
else
    echo "部署失败，请查看服务状态和日志" >&2
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 || true
    exit 1
fi
