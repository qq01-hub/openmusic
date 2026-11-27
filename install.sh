#!/bin/bash
set -euo pipefail

DEPLOY_DIR="${OPENMUSIC_DEPLOY_DIR:-/opt/openmusic}"
COMPOSE_FILE="docker-compose.full.yml"
LOUDNESS_COMPOSE_FILE="docker-compose.loudness.yml"
ENV_FILE=".env"
AUTO_YES="${OPENMUSIC_AUTO_YES:-0}"

is_real_cmd() {
    [ "$(type -t "$1" 2>/dev/null || true)" = "file" ]
}

ask_yes_no() {
    local prompt="$1"
    local default_ans="${2:-N}"
    local reply=""
    if [ "$AUTO_YES" = "1" ]; then
        reply="$default_ans"
    elif [ -t 0 ]; then
        read -r -p "$prompt " reply || reply="$default_ans"
    elif [ -r /dev/tty ]; then
        read -r -p "$prompt " reply < /dev/tty || reply="$default_ans"
    else
        reply="$default_ans"
    fi
    reply="${reply:-$default_ans}"
    [[ "$reply" =~ ^[Yy]$ ]]
}

run_privileged() {
    if [ "$(id -u 2>/dev/null || echo 1)" -eq 0 ]; then
        "$@"
    elif command -v sudo &> /dev/null; then
        sudo "$@"
    else
        return 1
    fi
}

port_in_use() {
    local port="$1"
    if command -v ss &> /dev/null; then
        ss -tln 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\\.)${port}$"
        return $?
    elif command -v netstat &> /dev/null; then
        netstat -tln 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\\.)${port}$"
        return $?
    fi
    return 1
}

pick_free_port() {
    local preferred="$1"
    local port="$preferred"
    local tries=0
    while [ "$tries" -lt 30 ] && port_in_use "$port"; do
        port=$((port + 1))
        tries=$((tries + 1))
    done
    if port_in_use "$port"; then
        echo "错误: ${preferred} 附近没有空闲端口" >&2
        return 1
    fi
    printf '%s' "$port"
}

pick_free_subnet() {
    local existing_subnets="" existing_routes=""
    if is_real_cmd docker; then
        existing_subnets="$(docker network ls -q | xargs -r docker network inspect --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}')"
    fi
    if command -v ip &> /dev/null; then
        existing_routes="$(ip -4 route show table all | awk '$1 ~ /^[0-9]/ {print $1}')"
    fi
    printf '%s\n' "$existing_subnets" "$existing_routes" | awk '
        {
            for (field = 1; field <= NF; field++) {
                if ($field !~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/) continue
                parts = split($field, address, /[.\/]/)
                mask_bits = parts == 5 ? address[5] : 32
                if (mask_bits == 0 || mask_bits > 32) continue
                size = 2 ^ (32 - mask_bits)
                first = address[1] * 16777216 + address[2] * 65536 + address[3] * 256 + address[4]
                start[++count] = int(first / size) * size
                end[count] = start[count] + size - 1
            }
        }
        END {
            for (octet = 80; octet <= 120; octet++) {
                first = 172 * 16777216 + 30 * 65536 + octet * 256
                for (subnet = 1; subnet <= count; subnet++) {
                    if (first <= end[subnet] && first + 255 >= start[subnet]) break
                }
                if (subnet > count) {
                    printf "172.30.%d.0/24", octet
                    exit 0
                }
            }
            exit 1
        }'
}

if [ -z "${OPENMUSIC_DEPLOY_DIR:-}" ] && { [ -e "$COMPOSE_FILE" ] || [ -e data/.env ]; }; then
    DEPLOY_DIR="$(pwd)"
    echo "检测到当前目录已有部署，沿用 $DEPLOY_DIR；迁移前请备份配置、数据及 Redis 卷"
fi
if ! mkdir -p "$DEPLOY_DIR"; then
    echo "错误: 无法创建部署目录 $DEPLOY_DIR，请使用有写入权限的账号或通过 OPENMUSIC_DEPLOY_DIR 指定目录" >&2
    exit 1
fi
cd "$DEPLOY_DIR"
echo "部署目录: $DEPLOY_DIR"
echo "宿主机持久化目录: $DEPLOY_DIR/data（删除容器不会删除此目录，请勿手动删除）"

echo "========================================"
echo "  OpenMusic 全自动一键部署"
echo "========================================"
echo ""

if ! command -v curl &> /dev/null; then
    echo "错误: 未检测到 curl，请先安装 curl 后重试" >&2
    exit 1
fi

if ! command -v docker &> /dev/null; then
    if ask_yes_no "未检测到 Docker，是否以管理员权限运行 Docker 官方安装脚本？[y/N]" "N"; then
        echo "正在自动安装 Docker..."
        docker_installer="$(mktemp)"
        trap 'rm -f "$docker_installer"' EXIT
        if ! curl -fsSL -o "$docker_installer" https://get.docker.com || ! run_privileged sh "$docker_installer"; then
            echo "错误: Docker 自动安装失败，请参考 https://docs.docker.com/engine/install/" >&2
            exit 1
        fi
        rm -f "$docker_installer"
        trap - EXIT
        if command -v systemctl &> /dev/null; then
            run_privileged systemctl enable --now docker >/dev/null 2>&1 || true
        elif command -v service &> /dev/null; then
            run_privileged service docker start >/dev/null 2>&1 || true
        fi
    else
        echo "错误: 未检测到 Docker" >&2
        echo "安装指南: https://docs.docker.com/engine/install/" >&2
        exit 1
    fi
fi

if ! docker compose version &> /dev/null; then
    echo "错误: Docker Compose 不可用，请升级 Docker 或安装 docker-compose-plugin" >&2
    exit 1
fi

if ! docker info > /dev/null 2>&1; then
    if is_real_cmd docker && ask_yes_no "Docker 引擎不可访问，是否尝试启动本机 Docker 服务？[y/N]" "N"; then
        echo "检测到 Docker 服务未运行，正在尝试自动启动..."
        if command -v systemctl &> /dev/null; then
            run_privileged systemctl enable --now docker >/dev/null 2>&1 || true
        elif command -v service &> /dev/null; then
            run_privileged service docker start >/dev/null 2>&1 || true
        fi
        for _ in 1 2 3 4 5; do
            if docker info > /dev/null 2>&1; then
                break
            fi
            sleep 2
        done
    fi
fi
if ! docker info > /dev/null 2>&1; then
    echo "错误: Docker 引擎不可访问，请先启动 Docker 并确认当前账号权限" >&2
    exit 1
fi

enable_loudness="${OPENMUSIC_ENABLE_LOUDNESS:-}"
if [ -z "$enable_loudness" ]; then
    if [ -f "$LOUDNESS_COMPOSE_FILE" ]; then
        enable_loudness=y
    else
        if ask_yes_no "是否启用响度均衡服务（额外占用内存）？[y/N]" "N"; then
            enable_loudness=y
        else
            enable_loudness=N
        fi
    fi
fi
COMPOSE_FILES=(-f "$COMPOSE_FILE")
if [[ "$enable_loudness" =~ ^[Yy]$ ]]; then
    echo "已选择响度辅助服务，将额外拉取 GHCR 镜像"
    COMPOSE_FILES+=(-f "$LOUDNESS_COMPOSE_FILE")
else
    echo "未启用响度辅助服务；各平台音量可能存在差异"
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

read_env_value() {
    local key="$1"
    local fallback="$2"
    local value=""
    if [ -f "$ENV_FILE" ]; then
        value="$(awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); gsub(/\r$/, ""); print; exit }' "$ENV_FILE" || true)"
    fi
    printf '%s' "${value:-$fallback}"
}

echo "正在下载配置文件..."
tmp_compose="$(mktemp "${COMPOSE_FILE}.tmp.XXXXXX")"
tmp_loudness=""
trap 'rm -f "$tmp_compose"; [ -z "$tmp_loudness" ] || rm -f "$tmp_loudness"' EXIT
if [ ! -f "$COMPOSE_FILE" ]; then
    curl -fsSL -o "$tmp_compose" https://raw.githubusercontent.com/qq01-hub/openmusic/main/docker-compose.full.yml
    mv "$tmp_compose" "$COMPOSE_FILE"
fi
if [[ "$enable_loudness" =~ ^[Yy]$ ]] && [ ! -f "$LOUDNESS_COMPOSE_FILE" ]; then
    tmp_loudness="$(mktemp "${LOUDNESS_COMPOSE_FILE}.tmp.XXXXXX")"
    curl -fsSL -o "$tmp_loudness" https://raw.githubusercontent.com/qq01-hub/openmusic/main/docker-compose.loudness.yml
    mv "$tmp_loudness" "$LOUDNESS_COMPOSE_FILE"
fi

echo ""
echo "正在生成配置..."
if [ ! -f "$ENV_FILE" ]; then
    if [ -z "${OPENMUSIC_PORT:-}" ]; then
        OPENMUSIC_PORT="$(pick_free_port 4000)"
        if [ "$OPENMUSIC_PORT" != "4000" ]; then
            echo "检测到默认端口 4000 已被占用，已自动选用空闲端口 ${OPENMUSIC_PORT}"
        fi
    fi
    if [ -z "${METING_PORT:-}" ]; then
        METING_PORT="$(pick_free_port 3000)"
        if [ "$METING_PORT" = "$OPENMUSIC_PORT" ]; then
            METING_PORT="$(pick_free_port $((METING_PORT + 1)))"
        fi
        if [ "$METING_PORT" != "3000" ]; then
            echo "检测到默认端口 3000 已被占用，Meting 已自动选用空闲端口 ${METING_PORT}"
        fi
    fi
    if [ -z "${OPENMUSIC_NETWORK_SUBNET:-}" ]; then
        if ! OPENMUSIC_NETWORK_SUBNET="$(pick_free_subnet)"; then
            echo "错误: 未找到可用的默认子网，请为 OPENMUSIC_NETWORK_SUBNET 指定未占用的网段" >&2
            exit 1
        fi
        if [ "$OPENMUSIC_NETWORK_SUBNET" != "172.30.80.0/24" ]; then
            echo "检测到默认子网 172.30.80.0/24 冲突，已自动切换至 ${OPENMUSIC_NETWORK_SUBNET}"
        fi
    fi
    METING_ADMIN_PATH="$(random_hex 8)"
    METING_PASSWORD="$(random_hex 16)"
    METING_USERNAME="admin"
    ENCRYPTION_KEY="$(generate_key)"

    (umask 077 && cat > "$ENV_FILE") << EOF
OPENMUSIC_PORT=$OPENMUSIC_PORT
OPENMUSIC_BIND_ADDRESS=${OPENMUSIC_BIND_ADDRESS:-127.0.0.1}
METING_PORT=$METING_PORT
OPENMUSIC_NETWORK_SUBNET=${OPENMUSIC_NETWORK_SUBNET:-172.30.80.0/24}
ALLOW_INSECURE_COOKIES=${ALLOW_INSECURE_COOKIES:-1}
METING_ADMIN_PATH=$METING_ADMIN_PATH
METING_ADMIN_USERNAME=$METING_USERNAME
METING_ADMIN_PASSWORD=$METING_PASSWORD
ROOM_CREDENTIAL_ENCRYPTION_KEY=$ENCRYPTION_KEY
EOF
    chmod 600 "$ENV_FILE"
    echo "已生成新的 .env 配置（权限 600）"
else
    echo "检测到已有 .env，保留现有配置和密钥"
    for required_var in METING_ADMIN_PATH METING_ADMIN_USERNAME METING_ADMIN_PASSWORD ROOM_CREDENTIAL_ENCRYPTION_KEY; do
        if ! grep -Eq "^${required_var}=.+$" "$ENV_FILE"; then
            echo "错误: .env 缺少非空配置 ${required_var}，为避免覆盖现有密钥，脚本已停止" >&2
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
        echo "已将异常目录移至 $backup_path 并保留备份"
    fi
    if [ -e "$config_file" ] && [ ! -f "$config_file" ]; then
        echo "错误: $config_file 不是普通文件，无法安全自动修复" >&2
        exit 1
    fi
done
[ -f data/.env ] || (umask 077 && : > data/.env)
[ -f data/setup.lock ] || touch data/setup.lock
[ -f data/runtimeConfig.json ] || printf '{}\n' > data/runtimeConfig.json
[ -f data/adminConfig.json ] || printf '{}\n' > data/adminConfig.json

echo ""
echo "正在启动 OpenMusic..."
if ! docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" config --quiet; then
    echo "错误: Compose 配置校验失败，未启动或重建容器；请检查 .env 中的凭据和 OPENMUSIC_NETWORK_SUBNET" >&2
    exit 1
fi
echo "所有服务使用同一项目的 openmusic 网络（显式子网），通过 redis、meting-api、meting-api-audio-loudness 网络名称互访"
echo "如子网与现有 Docker 网络或宿主机路由冲突，请调整部署目录 .env 的 OPENMUSIC_NETWORK_SUBNET 后重试；不要手动修改容器 IP"
compose_up_args=(-d --wait --wait-timeout 180)
if [ "$config_files_repaired" -eq 1 ]; then
    compose_up_args+=(--force-recreate)
fi
if docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" pull && docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" up "${compose_up_args[@]}"; then
    echo "正在自动配置 Meting API Token..."
    if ! docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" exec -T meting node -e 'const fs = require("node:fs"); const path = require("node:path"); const file = path.join(process.env.DATA_DIR || "/app/data", "api_tokens.json"); const tokens = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}; const token = Object.values(tokens).find(t => t.name === "OpenMusic joint deployment" && t.token && (!t.permissions || t.permissions.length === 0)); process.stdout.write(JSON.stringify({token: token?.token || "", username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD}));' |
        docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" exec -T openmusic node configureMeting.js; then
        echo "错误: Meting API Token 自动配置失败，配置及数据已保留，请检查两端管理后台" >&2
        exit 1
    fi
    docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" restart openmusic
    docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" up -d --no-deps --no-recreate --wait --wait-timeout 180 openmusic
    echo "正在检查容器间 DNS 和 HTTP 连通性..."
    if ! docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" exec -T openmusic node -e 'fetch("http://meting-api:3000", {signal: AbortSignal.timeout(10000), redirect: "manual"}).then(r => { if (r.status >= 500) throw new Error("Meting HTTP " + r.status); console.log("OpenMusic -> meting-api:3000 OK"); }).catch(e => { console.error(e.message); process.exit(1); })'; then
        echo "错误: OpenMusic 无法访问 Meting，请检查服务网络和日志；配置及数据已保留" >&2
        exit 1
    fi
    if [[ "$enable_loudness" =~ ^[Yy]$ ]]; then
        if ! docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" exec -T meting node -e 'fetch("http://meting-api-audio-loudness:3100/healthz", {signal: AbortSignal.timeout(10000)}).then(r => { if (!r.ok) throw new Error("响度 HTTP " + r.status); console.log("Meting -> meting-api-audio-loudness:3100 OK"); }).catch(e => { console.error(e.message); process.exit(1); })'; then
            echo "错误: Meting 无法访问响度服务，请检查统一网络和日志；配置及数据已保留" >&2
            exit 1
        fi
    fi
    openmusic_endpoint="$(docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" port openmusic 4000)"
    meting_endpoint="$(docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" port meting 3000)"
    actual_openmusic_port="${openmusic_endpoint##*:}"
    actual_meting_port="${meting_endpoint##*:}"
    actual_openmusic_port="${actual_openmusic_port:-$(read_env_value OPENMUSIC_PORT 4000)}"
    actual_meting_port="${actual_meting_port:-$(read_env_value METING_PORT 3000)}"
    echo ""
    echo "========================================"
    echo "  部署成功！"
    echo "========================================"
    echo ""
    echo "在本地电脑用原 SSH 账号和端口建立隧道"
    echo "  ssh -N -L ${actual_openmusic_port}:127.0.0.1:${actual_openmusic_port} -L ${actual_meting_port}:127.0.0.1:${actual_meting_port} user@server"
    echo "打开 http://localhost:${actual_openmusic_port}/setup，使用预填配置完成初始化并保存管理员凭据"
    echo "Meting 管理后台的入口和初始凭据保存在 ${DEPLOY_DIR}/${ENV_FILE}"
    echo "正式上线时请使用 HTTPS 域名，详见项目部署文档"
    echo ""
    echo "常用命令:"
    echo "  先进入部署目录: cd \"$DEPLOY_DIR\""
    echo "  查看日志: docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} logs -f"
    echo "  停止: docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} down"
    echo "  重启: docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} restart"
    echo "  更新: docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} pull && docker compose --env-file $ENV_FILE ${COMPOSE_FILES[*]} up -d"
    echo "备份提醒: 保留部署目录的 .env、data/ 和 Redis 命名卷，切勿执行 down -v"
    echo ""
else
    echo "部署失败，请查看服务状态和日志" >&2
    docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" ps || true
    docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" logs --tail=200 || true
    exit 1
fi
