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

print_banner() {
  cat <<'EOF'
=========================================
   OpenMusic 一键部署脚本
=========================================
EOF
}

# ---------- Docker 通用准备 ----------

check_docker() {
  if ! require_cmd docker; then
    err "未检测到 docker，请先安装：https://docs.docker.com/engine/install/"
    exit 1
  fi
  local compose_cmd
  compose_cmd="$(resolve_compose_cmd)"
  if [ -z "$compose_cmd" ]; then
    err "未检测到 docker compose（插件或独立版本均可），请先安装"
    exit 1
  fi
  echo "$compose_cmd"
}

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif require_cmd docker-compose; then
    echo "docker-compose"
  else
    echo ""
  fi
}

# ---------- 更新（拉取最新代码） ----------

# 这些路径是构建产物（依赖锁文件 / 增量编译缓存），本地跑过 install / build 后
# 内容常与远端不同、会挡住 git pull；后续 install / build 步骤会重新生成它们，
# 直接丢弃本地改动即可，不影响任何业务配置。
UPDATE_SAFE_RESET_PATHS=(
  "package-lock.json"
  "server/package-lock.json"
  "client/package-lock.json"
  "client/tsconfig.tsbuildinfo"
)

update_git_pull() {
  if ! require_cmd git; then
    err "未检测到 git，无法自动更新（非 git 安装的部署请手动替换代码）"
    exit 1
  fi
  if [ ! -d .git ]; then
    err "当前目录不是 git 仓库，无法自动更新"
    exit 1
  fi

  # 部署时给脚本 chmod +x、不同文件系统 / 编辑器保存方式等都可能只改动权限位、
  # 不改内容，却会让 git 永远把它当成「本地改动」挡住更新。这类噪音直接忽略，
  # 不影响真正的内容变更检测。仅设置本仓库局部配置，不影响其它项目。
  git config core.fileMode false

  local path
  for path in "${UPDATE_SAFE_RESET_PATHS[@]}"; do
    # 与 HEAD 比较：无论改动只在工作区还是已被 git add 暂存过，都能识别到，
    # 避免「改动已 add 过 → git diff（不比对暂存区）看不到 → 误判为没有本地改动」。
    if [ -f "$path" ] && ! git diff --quiet HEAD -- "$path" 2>/dev/null; then
      info "重置本地构建产物：$path"
      # 用 HEAD 显式指定版本：同时重置暂存区和工作区。只 checkout 工作区（不带 HEAD）
      # 在改动已被 add 过时不生效——那样只会把工作区重置成暂存区里同样过时的内容。
      git checkout HEAD -- "$path"
    fi
  done

  local exclude_args=()
  for path in "${UPDATE_SAFE_RESET_PATHS[@]}"; do
    exclude_args+=(":!$path")
  done
  if ! git diff --quiet HEAD -- . "${exclude_args[@]}"; then
    err "检测到其他未提交的本地改动，为避免覆盖已中止更新，请先自行处理（git status 查看）："
    git status --short
    exit 1
  fi

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  info "拉取最新代码（分支：$branch）..."
  git pull origin "$branch"
  ok "代码已更新"
}

# 尝试识别当前正在运行的部署方式；无法判断时返回空
detect_deploy_mode() {
  local compose_cmd
  compose_cmd="$(resolve_compose_cmd)"

  if [ -n "$compose_cmd" ] && [ -f docker-compose.full.yml ] && [ -f docker-compose.loudness.yml ] \
      && [ -n "$($compose_cmd -f docker-compose.full.yml -f docker-compose.loudness.yml ps -q loudness 2>/dev/null)" ]; then
    echo "docker-loudness"
    return
  fi
  if [ -n "$compose_cmd" ] && [ -f docker-compose.full.yml ] \
      && [ -n "$($compose_cmd -f docker-compose.full.yml ps -q meting 2>/dev/null)" ]; then
    echo "docker-full"
    return
  fi
  if [ -n "$compose_cmd" ] && [ -n "$($compose_cmd ps -q openmusic 2>/dev/null)" ]; then
    echo "docker"
    return
  fi
  if require_cmd pm2 && pm2 describe openmusic >/dev/null 2>&1; then
    echo "source"
    return
  fi
  echo ""
}

update_docker() {
  local compose_cmd
  compose_cmd="$(check_docker)"
  update_git_pull
  info "重新构建并启动容器..."
  $compose_cmd up -d --build
  ok "更新完成（Docker 精简版）"
}

update_docker_full() {
  local compose_cmd
  compose_cmd="$(check_docker)"
  update_git_pull
  info "重新构建并启动容器（含 Meting）..."
  $compose_cmd -f docker-compose.full.yml up -d --build
  configure_meting "$compose_cmd" -f docker-compose.full.yml
  ok "更新完成（Docker 全量版）"
}

update_docker_loudness() {
  local compose_cmd
  compose_cmd="$(check_docker)"
  update_git_pull
  info "重新构建并启动容器（含 Meting + 响度辅助服务）..."
  $compose_cmd -f docker-compose.full.yml -f docker-compose.loudness.yml pull loudness
  $compose_cmd -f docker-compose.full.yml -f docker-compose.loudness.yml up -d --build
  configure_meting "$compose_cmd" -f docker-compose.full.yml -f docker-compose.loudness.yml
  ok "更新完成（Docker 响度增强版）"
}

update_source() {
  check_node_version
  if ! require_cmd npm; then
    err "未检测到 npm"
    exit 1
  fi
  update_git_pull

  info "安装依赖（根 / server / client）..."
  npm run install:all

  info "构建前端..."
  npm run build

  ensure_pm2
  info "重启 PM2 服务..."
  if pm2 describe openmusic >/dev/null 2>&1; then
    pm2 restart openmusic
  else
    pm2 start deploy/ecosystem.config.cjs
  fi
  pm2 save

  ok "更新完成（源码部署）"
}

deploy_update() {
  local mode="${1:-}"
  if [ -z "$mode" ]; then
    info "正在识别当前部署方式..."
    mode="$(detect_deploy_mode)"
  fi

  if [ -z "$mode" ]; then
    warn "未能自动识别当前部署方式"
    echo "请选择要更新的部署方式："
    echo "  1) Docker 部署"
    echo "  2) Docker 全量部署（含 Meting）"
    echo "  3) Docker 全量部署 + 响度辅助服务"
    echo "  4) 源码部署（PM2）"
    read -r -p "输入 1、2、3 或 4: " choice
    case "$choice" in
      1) mode="docker" ;;
      2) mode="docker-full" ;;
      3) mode="docker-loudness" ;;
      4) mode="source" ;;
      *) err "无效选择"; exit 1 ;;
    esac
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

deploy_docker_loudness() {
  local compose_cmd
  compose_cmd="$(check_docker)"
  info "使用命令：$compose_cmd -f docker-compose.full.yml -f docker-compose.loudness.yml"
  prepare_data_dir

  info "启动容器（redis + meting + loudness）..."
  $compose_cmd -f docker-compose.full.yml -f docker-compose.loudness.yml pull loudness
  $compose_cmd -f docker-compose.full.yml -f docker-compose.loudness.yml up -d --build
  configure_meting "$compose_cmd" -f docker-compose.full.yml -f docker-compose.loudness.yml

  ok "部署完成（全量版，含 Meting + 响度辅助服务）"
  local port="${OPENMUSIC_PORT:-4000}"
  cat <<EOF

下一步：
  1. 浏览器打开 http://<服务器IP>:${port}/setup 完成首次部署向导
     - Redis、Meting 和响度服务已自动配置，只需填站点域名
  2. 向导完成后服务会自动重启，刷新页面即可
  3. 响度服务仅加入 Docker 内网，不直接暴露端口；Meting 会通过它统一各平台音量基准
  4. 常用命令：
     $compose_cmd -f docker-compose.full.yml -f docker-compose.loudness.yml logs -f loudness
     $compose_cmd -f docker-compose.full.yml -f docker-compose.loudness.yml down
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
}

prepare_data_dir() {
  mkdir -p data/downloads
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
  [ -f data/.env ] || : > data/.env
  [ -f data/runtimeConfig.json ] || echo '{}' > data/runtimeConfig.json
  [ -f data/adminConfig.json ] || echo '{}' > data/adminConfig.json
  [ -f data/setup.lock ] || : > data/setup.lock
  if [ -s data/setup.lock ]; then
    err "data/setup.lock 非空，为避免误判安装状态已中止；如需重新安装请先清空该文件"
    exit 1
  fi
}

# ---------- Docker 精简版（不含 Meting） ----------

deploy_docker() {
  local compose_cmd
  compose_cmd="$(check_docker)"
  info "使用命令：$compose_cmd"
  prepare_data_dir

  info "启动容器（redis + openmusic）..."
  if [ "$CONFIG_FILES_REPAIRED" -eq 1 ]; then
    $compose_cmd up -d --build --force-recreate openmusic
  else
    $compose_cmd up -d --build
  fi

  ok "部署完成"
  local port="${OPENMUSIC_PORT:-4000}"
  cat <<EOF

下一步：
  1. 浏览器打开 http://<服务器IP>:${port}/setup 完成首次部署向导
     - Redis 已自动配置，只需填 Meting 音源地址和站点域名
  2. 向导完成后服务会自动重启，刷新页面即可
  3. 常用命令：
     $compose_cmd logs -f openmusic   # 查看日志
     $compose_cmd down                # 停止
     $compose_cmd up -d --build       # 更新代码后重新构建启动
EOF
}

# ---------- Docker 全量版（含 Meting） ----------

deploy_docker_full() {
  local compose_cmd
  compose_cmd="$(check_docker)"
  info "使用命令：$compose_cmd -f docker-compose.full.yml"
  prepare_data_dir

  info "启动容器（redis + meting + openmusic）..."
  if [ "$CONFIG_FILES_REPAIRED" -eq 1 ]; then
    $compose_cmd -f docker-compose.full.yml up -d --build --force-recreate openmusic
  else
    $compose_cmd -f docker-compose.full.yml up -d --build
  fi
  configure_meting "$compose_cmd" -f docker-compose.full.yml

  ok "部署完成（全量版，含 Meting）"
  local port="${OPENMUSIC_PORT:-4000}"
  cat <<EOF

下一步：
  1. 浏览器打开 http://<服务器IP>:${port}/setup 完成首次部署向导
     - Redis 和 Meting 已自动配置，只需填站点域名
  2. 向导完成后服务会自动重启，刷新页面即可
  3. Meting 管理后台：http://<服务器IP>:${port} 不直接暴露 Meting 端口，
     如需配置 Meting Cookie，可进入容器：
     docker exec -it \$(docker compose -f docker-compose.full.yml ps -q meting) sh
  4. 常用命令：
     $compose_cmd -f docker-compose.full.yml logs -f openmusic   # 查看日志
     $compose_cmd -f docker-compose.full.yml down                # 停止
     $compose_cmd -f docker-compose.full.yml up -d --build       # 更新后重建
EOF
}

# ---------- 源码部署 ----------

check_node_version() {
  if ! require_cmd node; then
    err "未检测到 Node.js，请先安装 Node.js >= 18：https://nodejs.org/"
    exit 1
  fi
  local major
  major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$major" -lt 18 ]; then
    err "Node.js 版本过低（当前 $(node -v)），需要 >= 18"
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

deploy_source() {
  check_node_version
  if ! require_cmd npm; then
    err "未检测到 npm"
    exit 1
  fi

  info "安装依赖（根 / server / client）..."
  npm run install:all

  info "构建前端..."
  npm run build

  ensure_pm2

  info "使用 PM2 启动服务（deploy/ecosystem.config.cjs）..."
  pm2 start deploy/ecosystem.config.cjs
  pm2 save

  ok "部署完成"
  local port="${PORT:-4000}"
  cat <<EOF

下一步：
  1. 浏览器打开 http://<服务器IP>:${port}/setup 完成首次部署向导
     （若已存在有效 server/.env，会跳过向导）
  2. 向导完成后需要重启一次服务使 .env 生效：
     pm2 restart openmusic
  3. 常用命令：
     pm2 logs openmusic     # 查看日志
     pm2 restart openmusic  # 重启
     pm2 status             # 查看状态
  4. 如需开机自启：pm2 startup 按提示执行一次即可（pm2 save 已保存当前进程列表）
  5. 更新代码后重新部署：git pull 后再次执行本脚本（或手动 npm run build && pm2 restart openmusic）
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
    echo "请选择部署方式："
    echo "  1) Docker 部署（推荐，自带 Redis）"
    echo "  2) Docker 全量部署（自带 Redis + Meting，最省心）"
    echo "  3) Docker 全量部署 + 响度辅助服务"
    echo "  4) 源码部署（PM2，需自行提供 Redis）"
    echo "  5) 更新已有部署"
    read -r -p "输入 1、2、3、4 或 5: " choice
    case "$choice" in
      1) mode="docker" ;;
      2) mode="docker-full" ;;
      3) mode="docker-loudness" ;;
      4) mode="source" ;;
      5) deploy_update ""; return ;;
      *) err "无效选择"; exit 1 ;;
    esac
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
