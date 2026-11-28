#!/usr/bin/env bash
# OpenMusic 一键部署脚本
# 用法：
#   bash deploy/deploy.sh docker        # Docker 部署（自带 Redis，推荐）
#   bash deploy/deploy.sh docker-full   # Docker 全量部署（自带 Redis + Meting）
#   bash deploy/deploy.sh docker-loudness # Docker 全量部署 + 响度辅助服务
#   bash deploy/deploy.sh source        # 源码部署（PM2 常驻进程）
#   bash deploy/deploy.sh update        # 更新已有部署（自动识别方式，或加参数指定）
#   bash deploy/deploy.sh update docker|docker-full|source
#   bash deploy/deploy.sh               # 交互式选择
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

info() { printf '\033[36m[INFO]\033[0m %s\n' "$1"; }
ok()   { printf '\033[32m[OK]\033[0m %s\n' "$1"; }
warn() { printf '\033[33m[WARN]\033[0m %s\n' "$1"; }
err()  { printf '\033[31m[ERROR]\033[0m %s\n' "$1" >&2; }

require_cmd() { command -v "$1" >/dev/null 2>&1; }

AUTO_YES="${OPENMUSIC_AUTO_YES:-0}"

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
  elif require_cmd sudo; then
    sudo "$@"
  else
    return 1
  fi
}

port_in_use() {
  local port="$1"
  if require_cmd ss; then
    ss -tln 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\\.)${port}$"
    return $?
  elif require_cmd netstat; then
    netstat -tln 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\\.)${port}$"
    return $?
  fi
  return 1
}

pick_free_port() {
  local port="$1"
  local tries=0
  while [ "$tries" -lt 30 ] && port_in_use "$port"; do
    port=$((port + 1))
    tries=$((tries + 1))
  done
  printf '%s' "$port"
}

pick_free_subnet() {
  local existing_subnets="" existing_routes=""
  if require_cmd docker; then
    existing_subnets="$(docker network ls -q 2>/dev/null | xargs -r docker network inspect --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null || true)"
  fi
  if require_cmd ip; then
    existing_routes="$(ip -4 route show table all 2>/dev/null | awk '$1 ~ /^[0-9]/ {print $1}' || true)"
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
      printf "172.30.80.0/24"
    }'
}

print_banner() {
  cat <<'EOF'
=========================================
   OpenMusic 全自动一键部署脚本
=========================================
EOF
}

# ---------- Docker 通用准备 ----------

COMPOSE_CMD=""

ensure_docker() {
  if ! require_cmd docker; then
    if ask_yes_no "未检测到 Docker，是否自动安装 Docker（需管理员权限）？[Y/n]" "Y"; then
      if ! require_cmd curl; then
        err "未检测到 curl，请先安装 curl 后重试"
        exit 1
      fi
      info "正在自动安装 Docker..."
      local docker_installer
      docker_installer="$(mktemp)"
      if ! curl -fsSL -o "$docker_installer" https://get.docker.com || ! run_privileged sh "$docker_installer"; then
        rm -f "$docker_installer"
        err "Docker 自动安装失败，请参考 https://docs.docker.com/engine/install/"
        exit 1
      fi
      rm -f "$docker_installer"
      if require_cmd systemctl; then
        run_privileged systemctl enable --now docker >/dev/null 2>&1 || true
      elif require_cmd service; then
        run_privileged service docker start >/dev/null 2>&1 || true
      fi
    else
      err "未检测到 Docker，请先安装：https://docs.docker.com/engine/install/"
      exit 1
    fi
  fi
  COMPOSE_CMD="$(resolve_compose_cmd)"
  if [ -z "$COMPOSE_CMD" ]; then
    err "未检测到 Docker Compose 插件，请升级 Docker 或安装 docker-compose-plugin"
    exit 1
  fi
  if ! docker info >/dev/null 2>&1 && ask_yes_no "Docker 服务未运行，是否自动启动本机 Docker？[Y/n]" "Y"; then
    info "正在尝试启动本机 Docker 服务..."
    if require_cmd systemctl; then
      run_privileged systemctl enable --now docker >/dev/null 2>&1 || true
    elif require_cmd service; then
      run_privileged service docker start >/dev/null 2>&1 || true
    fi
    local i
    for i in 1 2 3 4 5; do
      docker info >/dev/null 2>&1 && break
      sleep 2
    done
  fi
  if ! docker info >/dev/null 2>&1; then
    err "Docker 引擎不可访问，请先启动 Docker 并确认当前账号权限"
    exit 1
  fi
}

write_docker_nginx_snippet() {
  local app_port="$1"
  local target_file="${ROOT_DIR}/nginx-openmusic-docker.conf"
  cat > "$target_file" <<EOF
# OpenMusic Docker 反代示例（由 deploy/deploy.sh 自动生成，已填入当前端口 ${app_port}）
# 将 music.example.com 替换为你的域名并配置 SSL 证书后，执行 nginx -t && nginx -s reload

map \$http_upgrade \$openmusic_connection_upgrade {
    default upgrade;
    ''      '';
}

server {
    listen 80;
    server_name music.example.com;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name music.example.com;
    server_tokens off;
    client_max_body_size 20m;

    ssl_certificate     /etc/letsencrypt/live/music.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/music.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    proxy_hide_header Strict-Transport-Security;
    proxy_hide_header X-Content-Type-Options;
    proxy_hide_header Referrer-Policy;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location ^~ /api/media-proxy {
        proxy_pass http://127.0.0.1:${app_port};
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header EO-Connecting-IP \$http_eo_connecting_ip;
        proxy_set_header CF-Connecting-IP \$http_cf_connecting_ip;
        proxy_set_header Range \$http_range;
        proxy_set_header If-Range \$http_if_range;
        proxy_cache off;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_max_temp_file_size 0;
        proxy_force_ranges on;
        gzip off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:${app_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$openmusic_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header EO-Connecting-IP \$http_eo_connecting_ip;
        proxy_set_header CF-Connecting-IP \$http_cf_connecting_ip;
        proxy_cache off;
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF
}

write_source_nginx_snippet() {
  local app_port="$1"
  local template_file="${ROOT_DIR}/deploy/nginx.conf.example"
  local target_file="${ROOT_DIR}/nginx-openmusic-source.conf"
  if [ ! -f "$template_file" ]; then
    return 0
  fi
  awk -v root_dir="${ROOT_DIR}" -v app_port="${app_port}" '
    {
      gsub(/\/www\/openmusic\/client\/dist/, root_dir "/client/dist")
      gsub(/127\.0\.0\.1:4000/, "127.0.0.1:" app_port)
      print
    }
  ' "$template_file" > "$target_file"
}

wait_local_health() {
  local app_port="$1"
  local i
  for i in $(seq 1 30); do
    if node -e 'fetch("http://127.0.0.1:" + process.argv[1] + "/api/health", {signal: AbortSignal.timeout(2000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' "$app_port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

read_env_value() {
  local file="$1"
  local key="$2"
  local fallback="$3"
  local value=""
  if [ -f "$file" ]; then
    value="$(awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); gsub(/\r$/, ""); print; exit }' "$file" || true)"
  fi
  printf '%s' "${value:-$fallback}"
}

setup_token_hint_text() {
  local token=""
  token="$(read_env_value data/.env SETUP_TOKEN '')"
  if [ -z "$token" ]; then token="$(read_env_value server/.env SETUP_TOKEN '')"; fi
  printf '%s' "${token:-（无，见服务端日志中的一次性令牌）}"
}

check_compose_config() {
  local compose_cmd="$1"
  shift
  if ! $compose_cmd "$@" config --quiet; then
    err "Compose 配置校验失败，未启动或重建容器；请检查 .env 中的凭据和 OPENMUSIC_NETWORK_SUBNET"
    exit 1
  fi
}

verify_container_connectivity() {
  local compose_cmd="$1"
  local check_loudness="$2"
  shift 2
  info "检查容器间 DNS 和 HTTP 连通性..."
  if ! $compose_cmd "$@" exec -T openmusic node -e 'fetch("http://meting-api:3000", {signal: AbortSignal.timeout(10000), redirect: "manual"}).then(r => { if (r.status >= 500) throw new Error("Meting HTTP " + r.status); console.log("OpenMusic -> meting-api:3000 OK"); }).catch(e => { console.error(e.message); process.exit(1); })'; then
    err "OpenMusic 无法访问 Meting，请检查服务网络和日志；配置及数据已保留"
    exit 1
  fi
  if [ "$check_loudness" = "1" ]; then
    if ! $compose_cmd "$@" exec -T meting node -e 'fetch("http://meting-api-audio-loudness:3100/healthz", {signal: AbortSignal.timeout(10000)}).then(r => { if (!r.ok) throw new Error("响度 HTTP " + r.status); console.log("Meting -> meting-api-audio-loudness:3100 OK"); }).catch(e => { console.error(e.message); process.exit(1); })'; then
      err "Meting 无法访问响度服务，请检查统一网络和日志；配置及数据已保留"
      exit 1
    fi
  fi
}

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  fi
}

# ---------- 更新（拉取最新代码） ----------

update_git_pull() {
  if ! require_cmd git; then
    err "未检测到 git，无法自动更新（非 git 安装的部署请手动替换代码）"
    exit 1
  fi
  if [ ! -e .git ]; then
    err "当前目录不是 git 仓库，无法自动更新"
    exit 1
  fi

  if ! git -c core.fileMode=false diff --quiet HEAD -- .; then
    err "检测到其他未提交的本地改动，为避免覆盖已中止更新，请先自行处理（git status 查看）："
    git status --short
    exit 1
  fi

  local branch
  branch="$(git symbolic-ref --quiet --short HEAD)" || { err "当前检出的是固定版本，请使用原部署方式更新"; exit 1; }
  info "拉取最新代码（分支：$branch）..."
  git -c core.fileMode=false pull --ff-only origin "$branch"
  ok "代码已更新"
}

# 尝试识别当前正在运行的部署方式；无法判断时返回空
detect_deploy_mode() {
  local compose_cmd
  compose_cmd="$(resolve_compose_cmd)"

  if [ -n "$compose_cmd" ] && [ -f docker-compose.full.yml ] && [ -f docker-compose.loudness.yml ] \
      && [ -n "$($compose_cmd -f docker-compose.full.yml -f docker-compose.loudness.yml ps -aq loudness 2>/dev/null)" ]; then
    echo "docker-loudness"
    return
  fi
  if [ -n "$compose_cmd" ] && [ -f docker-compose.full.yml ] \
      && [ -n "$($compose_cmd -f docker-compose.full.yml ps -aq meting 2>/dev/null)" ]; then
    echo "docker-full"
    return
  fi
  if [ -n "$compose_cmd" ] && [ -n "$($compose_cmd ps -aq openmusic 2>/dev/null)" ]; then
    echo "docker"
    return
  fi
  if require_cmd pm2 && require_cmd node && pm2 jlist 2>/dev/null | node -e 'const path = require("node:path"); const apps = JSON.parse(require("node:fs").readFileSync(0, "utf8")); process.exit(apps.some(app => app.name === "openmusic" && app.pm2_env?.pm_exec_path === path.resolve("server/index.js")) ? 0 : 1)' 2>/dev/null; then
    echo "source"
    return
  fi
  echo ""
}

update_docker() {
  ensure_docker
  local compose_cmd="$COMPOSE_CMD"
  update_git_pull
  local env_args=()
  [ -f .env ] && env_args=(--env-file .env)
  check_compose_config "$compose_cmd" "${env_args[@]}"
  info "重新构建并启动容器..."
  $compose_cmd "${env_args[@]}" up -d --build --wait --wait-timeout 180
  ok "更新完成（Docker 精简版）"
}

update_docker_full() {
  ensure_docker
  local compose_cmd="$COMPOSE_CMD"
  update_git_pull
  ensure_full_env_file
  check_compose_config "$compose_cmd" --env-file .env -f docker-compose.full.yml
  info "重新构建并启动容器（含 Meting）..."
  $compose_cmd --env-file .env -f docker-compose.full.yml pull redis meting
  $compose_cmd --env-file .env -f docker-compose.full.yml up -d --build --wait --wait-timeout 180
  configure_meting "$compose_cmd" --env-file .env -f docker-compose.full.yml
  verify_container_connectivity "$compose_cmd" 0 --env-file .env -f docker-compose.full.yml
  ok "更新完成（Docker 全量版）"
}

update_docker_loudness() {
  ensure_docker
  local compose_cmd="$COMPOSE_CMD"
  update_git_pull
  ensure_full_env_file
  check_compose_config "$compose_cmd" --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml
  info "重新构建并启动容器（含 Meting + 响度辅助服务）..."
  $compose_cmd --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml pull redis meting loudness
  $compose_cmd --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml up -d --build --wait --wait-timeout 180
  configure_meting "$compose_cmd" --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml
  verify_container_connectivity "$compose_cmd" 1 --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml
  ok "更新完成（Docker 响度增强版）"
}

update_source() {
  check_node_version
  if ! require_cmd npm; then
    err "未检测到 npm"
    exit 1
  fi
  update_git_pull

  info "安装依赖（server / client / deploy/updater）..."
  npm ci --prefix server --omit=dev
  npm ci --prefix client --include=dev
  npm ci --prefix deploy/updater --omit=dev

  info "构建前端..."
  npm run build

  ensure_pm2
  info "重启 PM2 服务..."
  pm2 startOrReload deploy/ecosystem.config.cjs --update-env
  pm2 save

  local port
  port="$(read_env_value server/.env PORT "${PORT:-4000}")"
  info "等待本机健康检查（127.0.0.1:${port}/api/health）..."
  if ! wait_local_health "$port"; then
    err "服务未在预期时间内通过健康检查，请查看以下日志排查："
    pm2 logs openmusic --lines 40 --nostream || true
    exit 1
  fi

  ok "更新完成（源码部署）"
}

deploy_update() {
  local mode="${1:-}"
  if [ -z "$mode" ]; then
    info "正在识别当前部署方式..."
    mode="$(detect_deploy_mode)"
  fi

  if [ -z "$mode" ]; then
    err "未识别到现有部署，请使用原方式指定 update docker、update docker-full、update docker-loudness 或 update source"
    exit 1
  else
    info "识别到当前部署方式：$mode"
  fi

  case "$mode" in
    docker)      update_docker ;;
    docker-full) update_docker_full ;;
    docker-loudness) update_docker_loudness ;;
    source)      update_source ;;
    *)
      err "未知部署方式：$mode（可选 docker / docker-full / docker-loudness / source）"
      exit 1
      ;;
  esac
}

# ---------- Docker 全量版 + 响度辅助服务 ----------

ensure_basic_env_file() {
  local env_file=".env"
  if [ ! -f "$env_file" ]; then
    local openmusic_port="${OPENMUSIC_PORT:-}"
    local network_subnet="${OPENMUSIC_NETWORK_SUBNET:-}"
    local bind_address="${OPENMUSIC_BIND_ADDRESS:-}"
    if [ -z "$openmusic_port" ]; then
      openmusic_port="$(pick_free_port 4000)"
      [ "$openmusic_port" = "4000" ] || info "默认端口 4000 已被占用，自动选用空闲端口 ${openmusic_port}"
    fi
    if [ -z "$network_subnet" ]; then
      network_subnet="$(pick_free_subnet)"
      [ "$network_subnet" = "172.30.80.0/24" ] || info "默认子网冲突，自动切换至 ${network_subnet}"
    fi
    if [ -z "$bind_address" ]; then
      if ask_yes_no "是否直接监听公网端口以便通过服务器 IP 打开向导（有域名配 Nginx 反代建议选 N，仅听本机）？[y/N]" "N"; then
        bind_address="0.0.0.0"
      else
        bind_address="127.0.0.1"
      fi
    fi
    (umask 077 && cat > "$env_file") <<EOF
OPENMUSIC_PORT=$openmusic_port
OPENMUSIC_BIND_ADDRESS=$bind_address
OPENMUSIC_NETWORK_SUBNET=$network_subnet
ALLOW_INSECURE_COOKIES=${ALLOW_INSECURE_COOKIES:-1}
EOF
    chmod 600 "$env_file"
    ok "已自动生成根目录 $env_file 配置（权限 600）"
  fi
}

ensure_full_env_file() {
  local env_file=".env"
  if [ ! -f "$env_file" ]; then
    local openmusic_port="${OPENMUSIC_PORT:-}"
    local meting_port="${METING_PORT:-}"
    local network_subnet="${OPENMUSIC_NETWORK_SUBNET:-}"
    local bind_address="${OPENMUSIC_BIND_ADDRESS:-}"
    if [ -z "$openmusic_port" ]; then
      openmusic_port="$(pick_free_port 4000)"
      [ "$openmusic_port" = "4000" ] || info "默认端口 4000 已被占用，自动选用空闲端口 ${openmusic_port}"
    fi
    if [ -z "$meting_port" ]; then
      meting_port="$(pick_free_port 3000)"
      [ "$meting_port" = "$openmusic_port" ] && meting_port="$(pick_free_port $((meting_port + 1)))"
      [ "$meting_port" = "3000" ] || info "默认端口 3000 已被占用，Meting 自动选用空闲端口 ${meting_port}"
    fi
    if [ -z "$network_subnet" ]; then
      network_subnet="$(pick_free_subnet)"
      [ "$network_subnet" = "172.30.80.0/24" ] || info "默认子网冲突，自动切换至 ${network_subnet}"
    fi
    if [ -z "$bind_address" ]; then
      if ask_yes_no "是否直接监听公网端口以便通过服务器 IP 打开向导（有域名配 Nginx 反代建议选 N，仅听本机）？[y/N]" "N"; then
        bind_address="0.0.0.0"
      else
        bind_address="127.0.0.1"
      fi
    fi
    local meting_admin_path
    local meting_pw
    local encryption_key
    if require_cmd openssl; then
      meting_admin_path="$(openssl rand -hex 8)"
      meting_pw="$(openssl rand -hex 16)"
      encryption_key="$(openssl rand -hex 32)"
    else
      meting_admin_path="$(od -An -N 8 -tx1 /dev/urandom | tr -d ' \n')"
      meting_pw="$(od -An -N 16 -tx1 /dev/urandom | tr -d ' \n')"
      encryption_key="$(od -An -N 32 -tx1 /dev/urandom | tr -d ' \n')"
    fi
    (umask 077 && cat > "$env_file") <<EOF
OPENMUSIC_PORT=$openmusic_port
OPENMUSIC_BIND_ADDRESS=$bind_address
METING_PORT=$meting_port
OPENMUSIC_NETWORK_SUBNET=$network_subnet
ALLOW_INSECURE_COOKIES=${ALLOW_INSECURE_COOKIES:-1}
METING_ADMIN_PATH=$meting_admin_path
METING_ADMIN_USERNAME=admin
METING_ADMIN_PASSWORD=$meting_pw
ROOM_CREDENTIAL_ENCRYPTION_KEY=$encryption_key
EOF
    chmod 600 "$env_file"
    ok "已自动生成根目录 $env_file 配置（权限 600）"
  else
    for required_var in METING_ADMIN_PATH METING_ADMIN_USERNAME METING_ADMIN_PASSWORD ROOM_CREDENTIAL_ENCRYPTION_KEY; do
      if ! grep -Eq "^${required_var}=.+$" "$env_file"; then
        err "$env_file 缺少非空配置 ${required_var}，为避免覆盖现有密钥已中止，请先补齐该字段"
        exit 1
      fi
    done
  fi
}

deploy_docker_loudness() {
  ensure_docker
  local compose_cmd="$COMPOSE_CMD"
  info "使用命令：$compose_cmd --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml"
  ensure_full_env_file
  prepare_data_dir
  check_compose_config "$compose_cmd" --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml

  info "启动容器（redis + meting + loudness + openmusic）..."
  if ! $compose_cmd --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml pull redis meting loudness; then
    err "依赖镜像拉取失败，如访问 Docker Hub / GHCR 受限请配置镜像加速后重试（已有 .env 与数据会自动保留）"
    exit 1
  fi
  if [ "$CONFIG_FILES_REPAIRED" -eq 1 ]; then
    $compose_cmd --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml up -d --build --wait --wait-timeout 180 --force-recreate
  else
    $compose_cmd --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml up -d --build --wait --wait-timeout 180
  fi
  configure_meting "$compose_cmd" --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml
  verify_container_connectivity "$compose_cmd" 1 --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml

  ok "部署完成（全量版，含 Meting + 响度辅助服务）"
  local port meting_port bind_address
  port="$(read_env_value .env OPENMUSIC_PORT "${OPENMUSIC_PORT:-4000}")"
  meting_port="$(read_env_value .env METING_PORT "${METING_PORT:-3000}")"
  bind_address="$(read_env_value .env OPENMUSIC_BIND_ADDRESS 127.0.0.1)"
  write_docker_nginx_snippet "$port"
  cat <<EOF

下一步：
  1. 打开首次部署向导（Redis、Meting 与响度服务已自动配置）：
     $( [ "$bind_address" = "0.0.0.0" ] || [ "$bind_address" = "::" ] && echo "浏览器访问 http://<你的服务器IP>:${port}/setup（确保已放行 ${port}/tcp）" || echo "先建立 SSH 隧道，再访问 http://localhost:${port}/setup" )
     首次安装令牌：$(setup_token_hint_text)（打开向导前先访问同地址同端口的 /api/setup/authorize?token=<令牌> 完成授权，会自动跳回向导）
  2. 向导完成后服务会自动重启，刷新页面即可
  3. 已自动生成开箱即用的 Nginx HTTPS 反代示例：${ROOT_DIR}/nginx-openmusic-docker.conf
     上线 HTTPS 后执行一行命令收紧 Cookie 安全：
     sed -i 's/^ALLOW_INSECURE_COOKIES=.*/ALLOW_INSECURE_COOKIES=0/' .env && $compose_cmd --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml up -d --force-recreate --wait openmusic
  4. Meting 后台仅绑定本机回环（凭据见 .env），远程管理请使用 SSH 隧道：
     ssh -N -L ${port}:127.0.0.1:${port} -L ${meting_port}:127.0.0.1:${meting_port} user@server
     Meting 管理入口见 .env 中的 METING_ADMIN_PATH
  5. 常用命令：
     $compose_cmd --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml logs -f loudness
     $compose_cmd --env-file .env -f docker-compose.full.yml -f docker-compose.loudness.yml down
EOF
}

configure_meting() {
  local compose_cmd="$1"
  shift
  info "自动配置 Meting API Token..."
  if ! $compose_cmd "$@" exec -T meting node -e 'const fs = require("node:fs"); const path = require("node:path"); const file = path.join(process.env.DATA_DIR || "/app/data", "api_tokens.json"); const tokens = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}; const token = Object.values(tokens).find(t => t.name === "OpenMusic joint deployment" && t.token && (!t.permissions || t.permissions.length === 0)); process.stdout.write(JSON.stringify({token: token?.token || "", username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD}));' |
      $compose_cmd "$@" exec -T openmusic node configureMeting.js; then
    err "Meting API Token 自动配置失败，配置及数据已保留，请检查两端管理后台"
    exit 1
  fi
  $compose_cmd "$@" restart openmusic
  $compose_cmd "$@" up -d --no-deps --no-recreate --wait --wait-timeout 180 openmusic
}

prepare_data_dir() {
  mkdir -p data/downloads data/meting
  CONFIG_FILES_REPAIRED=0
  for config_file in data/.env data/runtimeConfig.json data/adminConfig.json data/setup.lock; do
    if [ -d "$config_file" ]; then
      backup_path="${config_file}.directory-backup-$(date +%Y%m%d%H%M%S)-$$"
      mv -- "$config_file" "$backup_path"
      CONFIG_FILES_REPAIRED=1
      warn "已将异常目录移至 $backup_path 并保留备份"
    fi
    if [ -e "$config_file" ] && [ ! -f "$config_file" ]; then
      err "$config_file 不是普通文件，无法安全自动修复"
      exit 1
    fi
  done
  [ -f data/.env ] || (umask 077 && : > data/.env)
  [ -f data/runtimeConfig.json ] || echo '{}' > data/runtimeConfig.json
  [ -f data/adminConfig.json ] || echo '{}' > data/adminConfig.json
  [ -f data/setup.lock ] || : > data/setup.lock
  # 首次安装一次性令牌：服务端从 data/.env（挂载为 server/.env）读取 SETUP_TOKEN
  if [ ! -s data/setup.lock ] && ! grep -Eq '^SETUP_TOKEN=.+' data/.env; then
    printf 'SETUP_TOKEN=%s\n' "$(openssl rand -hex 32)" >> data/.env
    chmod 600 data/.env
  fi
}

# ---------- Docker 精简版（不含 Meting） ----------

deploy_docker() {
  ensure_docker
  local compose_cmd="$COMPOSE_CMD"
  info "使用命令：$compose_cmd"
  ensure_basic_env_file
  prepare_data_dir
  check_compose_config "$compose_cmd" --env-file .env

  info "启动容器（redis + openmusic）..."
  if [ "$CONFIG_FILES_REPAIRED" -eq 1 ]; then
    $compose_cmd --env-file .env up -d --build --wait --wait-timeout 180 --force-recreate
  else
    $compose_cmd --env-file .env up -d --build --wait --wait-timeout 180
  fi

  ok "部署完成"
  local port bind_address
  port="$(read_env_value .env OPENMUSIC_PORT "${OPENMUSIC_PORT:-4000}")"
  bind_address="$(read_env_value .env OPENMUSIC_BIND_ADDRESS 127.0.0.1)"
  write_docker_nginx_snippet "$port"
  cat <<EOF

下一步：
  1. 打开首次部署向导（Redis 已自动配置，只需填 Meting 音源地址和站点域名）：
     $( [ "$bind_address" = "0.0.0.0" ] || [ "$bind_address" = "::" ] && echo "浏览器访问 http://<你的服务器IP>:${port}/setup（确保已放行 ${port}/tcp）" || echo "本地执行 ssh -N -L ${port}:127.0.0.1:${port} user@server，再访问 http://localhost:${port}/setup" )
     首次安装令牌：$(setup_token_hint_text)（打开向导前先访问同地址同端口的 /api/setup/authorize?token=<令牌> 完成授权，会自动跳回向导）
  2. 向导完成后服务会自动重启，刷新页面即可
  3. 已自动生成开箱即用的 Nginx HTTPS 反代示例：${ROOT_DIR}/nginx-openmusic-docker.conf
     上线 HTTPS 后执行一行命令收紧 Cookie 安全：
     sed -i 's/^ALLOW_INSECURE_COOKIES=.*/ALLOW_INSECURE_COOKIES=0/' .env && $compose_cmd --env-file .env up -d --force-recreate --wait openmusic
  4. 常用命令：
     $compose_cmd --env-file .env logs -f openmusic   # 查看日志
     $compose_cmd --env-file .env down                # 停止
     $compose_cmd --env-file .env up -d --build       # 更新代码后重新构建启动
EOF
}

# ---------- Docker 全量版（含 Meting） ----------

deploy_docker_full() {
  ensure_docker
  local compose_cmd="$COMPOSE_CMD"
  info "使用命令：$compose_cmd --env-file .env -f docker-compose.full.yml"
  ensure_full_env_file
  prepare_data_dir
  check_compose_config "$compose_cmd" --env-file .env -f docker-compose.full.yml

  info "启动容器（redis + meting + openmusic）..."
  if ! $compose_cmd --env-file .env -f docker-compose.full.yml pull redis meting; then
    err "依赖镜像拉取失败，如访问 Docker Hub 受限请配置镜像加速后重试（已有 .env 与数据会自动保留）"
    exit 1
  fi
  if [ "$CONFIG_FILES_REPAIRED" -eq 1 ]; then
    $compose_cmd --env-file .env -f docker-compose.full.yml up -d --build --wait --wait-timeout 180 --force-recreate
  else
    $compose_cmd --env-file .env -f docker-compose.full.yml up -d --build --wait --wait-timeout 180
  fi
  configure_meting "$compose_cmd" --env-file .env -f docker-compose.full.yml
  verify_container_connectivity "$compose_cmd" 0 --env-file .env -f docker-compose.full.yml

  ok "部署完成（全量版，含 Meting）"
  local port meting_port bind_address
  port="$(read_env_value .env OPENMUSIC_PORT "${OPENMUSIC_PORT:-4000}")"
  meting_port="$(read_env_value .env METING_PORT "${METING_PORT:-3000}")"
  bind_address="$(read_env_value .env OPENMUSIC_BIND_ADDRESS 127.0.0.1)"
  write_docker_nginx_snippet "$port"
  cat <<EOF

下一步：
  1. 打开首次部署向导（Redis 和 Meting 已自动配置，只需填站点域名）：
     $( [ "$bind_address" = "0.0.0.0" ] || [ "$bind_address" = "::" ] && echo "浏览器访问 http://<你的服务器IP>:${port}/setup（确保已放行 ${port}/tcp）" || echo "先建立 SSH 隧道，再访问 http://localhost:${port}/setup" )
     首次安装令牌：$(setup_token_hint_text)（打开向导前先访问同地址同端口的 /api/setup/authorize?token=<令牌> 完成授权，会自动跳回向导）
  2. 向导完成后服务会自动重启，刷新页面即可
  3. 已自动生成开箱即用的 Nginx HTTPS 反代示例：${ROOT_DIR}/nginx-openmusic-docker.conf
     上线 HTTPS 后执行一行命令收紧 Cookie 安全：
     sed -i 's/^ALLOW_INSECURE_COOKIES=.*/ALLOW_INSECURE_COOKIES=0/' .env && $compose_cmd --env-file .env -f docker-compose.full.yml up -d --force-recreate --wait openmusic
  4. Meting 管理后台仅绑定本机回环（凭据见 .env），远程管理请使用 SSH 隧道：
     ssh -N -L ${port}:127.0.0.1:${port} -L ${meting_port}:127.0.0.1:${meting_port} user@server
     Meting 管理入口见 .env 中的 METING_ADMIN_PATH
  5. 常用命令：
     $compose_cmd --env-file .env -f docker-compose.full.yml logs -f openmusic   # 查看日志
     $compose_cmd --env-file .env -f docker-compose.full.yml down                # 停止
     $compose_cmd --env-file .env -f docker-compose.full.yml up -d --build       # 更新后重建
EOF
}

# ---------- 源码部署 ----------

install_node_22() {
  if ! require_cmd curl; then
    err "未检测到 curl，请先安装 curl 或手动安装 Node.js 20~24"
    return 1
  fi
  local setup_script
  setup_script="$(mktemp)"
  if require_cmd apt-get; then
    if curl -fsSL -o "$setup_script" https://deb.nodesource.com/setup_22.x && run_privileged bash "$setup_script" && run_privileged apt-get install -y -qq nodejs; then
      rm -f "$setup_script"
      return 0
    fi
  elif require_cmd dnf; then
    if curl -fsSL -o "$setup_script" https://rpm.nodesource.com/setup_22.x && run_privileged bash "$setup_script" && run_privileged dnf install -y -q nodejs; then
      rm -f "$setup_script"
      return 0
    fi
  elif require_cmd yum; then
    if curl -fsSL -o "$setup_script" https://rpm.nodesource.com/setup_22.x && run_privileged bash "$setup_script" && run_privileged yum install -y -q nodejs; then
      rm -f "$setup_script"
      return 0
    fi
  fi
  rm -f "$setup_script"
  return 1
}

check_node_version() {
  if ! require_cmd node; then
    if ask_yes_no "未检测到 Node.js，是否自动安装 Node.js 22 LTS（需管理员权限）？[Y/n]" "Y"; then
      info "正在自动安装 Node.js 22 LTS..."
      if ! install_node_22 || ! require_cmd node; then
        err "Node.js 自动安装失败，请手动安装 Node.js >= 20 且 < 25：https://nodejs.org/"
        exit 1
      fi
    else
      err "未检测到 Node.js，请先安装 Node.js >= 20 且 < 25：https://nodejs.org/"
      exit 1
    fi
  fi
  local major
  major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$major" -lt 20 ] || [ "$major" -ge 25 ]; then
    err "当前 Node.js 为 $(node -v)，需要 >= 20 且 < 25"
    exit 1
  fi
  ok "Node.js $(node -v)"
}

ensure_pm2() {
  if require_cmd pm2; then
    ok "PM2 $(pm2 -v)"
    return
  fi
  info "未检测到 PM2，正在全局安装..."
  if ! npm install -g pm2; then
    err "PM2 安装失败，请手动执行：npm install -g pm2"
    exit 1
  fi
  ok "PM2 安装完成"
}

ensure_local_redis() {
  if [ -s server/.env ]; then
    return 0
  fi
  if port_in_use 6379; then
    info "本机端口 6379 已占用，请在部署向导中验证 Redis 连接"
    return 0
  fi
  if ask_yes_no "是否通过系统软件源安装并启动本机 Redis？[y/N]" "N"; then
    if require_cmd apt-get; then
      run_privileged apt-get update -qq && run_privileged apt-get install -y -qq redis-server && run_privileged systemctl enable --now redis-server >/dev/null 2>&1 || true
    elif require_cmd dnf; then
      run_privileged dnf install -y -q redis && run_privileged systemctl enable --now redis >/dev/null 2>&1 || true
    elif require_cmd yum; then
      run_privileged yum install -y -q redis && run_privileged systemctl enable --now redis >/dev/null 2>&1 || true
    else
      warn "未识别系统包管理器，请稍后在部署向导中填写已有 Redis 连接地址"
      return 0
    fi
    if require_cmd redis-cli && [ "$(redis-cli -h 127.0.0.1 ping 2>/dev/null || true)" = "PONG" ]; then
      ok "本机 Redis 已自动安装并启动"
    else
      warn "本机 Redis 尚未在 6379 端口就绪，可在部署向导中手动填写 Redis 地址"
    fi
  fi
}

deploy_source() {
  check_node_version
  if ! require_cmd npm; then
    err "未检测到 npm"
    exit 1
  fi
  ensure_local_redis

  info "安装依赖（server / client / deploy/updater）..."
  npm ci --prefix server --omit=dev
  npm ci --prefix client --include=dev
  npm ci --prefix deploy/updater --omit=dev

  info "构建前端..."
  npm run build

  ensure_pm2

  # 首次安装一次性令牌：预先写入 server/.env（服务端 dotenv 读取），已装站点不生成
  if [ ! -s server/setup.lock ] && ! grep -Eq '^(REDIS_URL|REDIS_HOST)=.+' server/.env 2>/dev/null && ! grep -Eq '^SETUP_TOKEN=.+' server/.env 2>/dev/null; then
    (umask 077 && printf 'SETUP_TOKEN=%s\n' "$(openssl rand -hex 32)" >> server/.env)
    chmod 600 server/.env
  fi

  info "使用 PM2 启动服务（deploy/ecosystem.config.cjs）..."
  pm2 startOrReload deploy/ecosystem.config.cjs --update-env
  pm2 save
  if [ "$(id -u 2>/dev/null || echo 1)" -eq 0 ] && require_cmd systemctl && [ ! -f /etc/systemd/system/pm2-root.service ]; then
    if ask_yes_no "是否配置 PM2 开机自启？[Y/n]" "Y"; then
      pm2 startup systemd -u root --hp /root >/dev/null 2>&1 && pm2 save >/dev/null 2>&1 && ok "PM2 开机自启已配置" || warn "PM2 开机自启配置未自动完成，可手动执行：pm2 startup"
    fi
  fi

  local port
  port="$(read_env_value server/.env PORT "${PORT:-4000}")"
  info "等待本机健康检查（127.0.0.1:${port}/api/health）..."
  if ! wait_local_health "$port"; then
    err "服务未在预期时间内通过健康检查，请查看以下日志排查："
    pm2 logs openmusic --lines 40 --nostream || true
    exit 1
  fi
  write_source_nginx_snippet "$port"

  ok "部署完成"
  cat <<EOF

下一步：
  1. 用原 SSH 账号建立隧道后，打开 http://localhost:${port}/setup 完成首次部署向导
     （若已存在有效 server/.env，会跳过向导）
     首次安装令牌：$(setup_token_hint_text)（打开向导前先访问同地址同端口的 /api/setup/authorize?token=<令牌> 完成授权，会自动跳回向导）
  2. 向导完成后需要重启一次服务使 .env 生效：
     pm2 restart openmusic --update-env
  3. 已按当前目录与端口自动生成 Nginx 静态直出模板：${ROOT_DIR}/nginx-openmusic-source.conf
     配好 HTTPS 反代后，建议在 server/.env 中设置 HOST=127.0.0.1 避免绕过反代直连 Node 端口
  4. 常用命令：
     pm2 logs openmusic     # 查看日志
     pm2 restart openmusic  # 重启
     pm2 status             # 查看状态
  5. 如需开机自启：pm2 startup 按提示执行一次即可（pm2 save 已保存当前进程列表）
  6. 后续更新代码：bash deploy/deploy.sh update source
EOF
}

# ---------- 入口 ----------

main() {
  print_banner
  local mode="${1:-}"

  if [ "$mode" = "update" ]; then
    deploy_update "${2:-}"
    return
  fi

  if [ -z "$mode" ]; then
    local detected_mode
    detected_mode="$(detect_deploy_mode)"
    if [ -n "$detected_mode" ]; then
      if ask_yes_no "检测到已有部署（${detected_mode}），是否立即更新？[Y/n]" "Y"; then
        deploy_update "$detected_mode"
      fi
      return
    fi
    exec "$BASH" "$ROOT_DIR/install.sh"
  fi

  case "$mode" in
    docker)      deploy_docker ;;
    docker-full) deploy_docker_full ;;
    docker-loudness) deploy_docker_loudness ;;
    source)      deploy_source ;;
    *)
      err "未知部署方式：$mode（可选 docker / docker-full / docker-loudness / source / update）"
      exit 1
      ;;
  esac
}

main "$@"
