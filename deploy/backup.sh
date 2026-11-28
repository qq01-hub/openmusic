#!/bin/bash
# OpenMusic 部署备份：打包部署目录 .env、data/ 与 Redis 数据（BGSAVE 后整卷导出）
#
# 用法：
#   OPENMUSIC_DEPLOY_DIR=/opt/openmusic bash deploy/backup.sh
# 环境变量：
#   OPENMUSIC_DEPLOY_DIR  部署目录（默认 /opt/openmusic，即 install.sh 的默认目录）
#   OPENMUSIC_BACKUP_DIR  备份输出目录（默认 <部署目录>/backups）
#   OPENMUSIC_BACKUP_KEEP 保留最近几份（默认 7）
#   COMPOSE_PROJECT_NAME  部署的 Compose 项目名（与部署时保持一致，默认按目录名推导）
#
# 备份含全部凭据与密钥，输出文件权限 600，请勿同步到不受信的位置。
# 恢复方法见 docs/DEPLOY.md「备份与恢复」。
set -euo pipefail

DEPLOY_DIR="${OPENMUSIC_DEPLOY_DIR:-/opt/openmusic}"
BACKUP_DIR="${OPENMUSIC_BACKUP_DIR:-${DEPLOY_DIR}/backups}"
KEEP="${OPENMUSIC_BACKUP_KEEP:-7}"

if [ ! -d "$DEPLOY_DIR" ]; then
    echo "错误: 部署目录不存在：$DEPLOY_DIR" >&2
    exit 1
fi
if [ ! -f "$DEPLOY_DIR/.env" ]; then
    echo "错误: $DEPLOY_DIR/.env 不存在，不像一个完整的部署目录" >&2
    exit 1
fi

COMPOSE_FILES=()
if [ -f "$DEPLOY_DIR/docker-compose.full.yml" ]; then
    COMPOSE_FILES=(-f "$DEPLOY_DIR/docker-compose.full.yml")
    [ -f "$DEPLOY_DIR/docker-compose.loudness.yml" ] && COMPOSE_FILES+=(-f "$DEPLOY_DIR/docker-compose.loudness.yml")
elif [ -f "$DEPLOY_DIR/docker-compose.yml" ]; then
    COMPOSE_FILES=(-f "$DEPLOY_DIR/docker-compose.yml")
else
    echo "错误: $DEPLOY_DIR 下未找到 docker-compose*.yml" >&2
    exit 1
fi

compose() {
    docker compose --project-directory "$DEPLOY_DIR" --env-file "$DEPLOY_DIR/.env" "${COMPOSE_FILES[@]}" "$@"
}

timestamp="$(date +%Y%m%d%H%M%S)"
staging="$(mktemp -d "${TMPDIR:-/tmp}/openmusic-backup.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/redis"
install -d -m 700 "$BACKUP_DIR"

echo "正在备份配置与数据目录..."
cp -a "$DEPLOY_DIR/.env" "$staging/.env"
if [ -d "$DEPLOY_DIR/data" ]; then
    cp -a "$DEPLOY_DIR/data" "$staging/data"
fi

echo "正在备份 Redis 数据..."
redis_container="$(compose ps -q redis 2>/dev/null || true)"
if [ -n "$redis_container" ] && [ "$(docker inspect -f '{{.State.Running}}' "$redis_container" 2>/dev/null || true)" = "true" ]; then
    # 容器内 REDIS_PASSWORD 环境变量由 compose 注入；无密码时为空展开
    compose exec -T redis sh -c 'redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD" --no-auth-warning} BGSAVE' > /dev/null
    for _ in $(seq 1 60); do
        in_progress="$(compose exec -T redis sh -c 'redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD" --no-auth-warning} INFO persistence' | awk -F: '$1 == "rdb_bgsave_in_progress" { gsub(/\r/, "", $2); print $2 }')"
        [ "$in_progress" != "1" ] && break
        sleep 1
    done
    # 整卷导出（含 dump.rdb 与 AOF 目录），比只拷 dump.rdb 更完整
    compose exec -T redis tar -cf - -C /data . > "$staging/redis/redis-data.tar"
    echo "Redis 数据已导出（容器运行中，BGSAVE 快照）"
else
    echo "警告: Redis 容器未运行，跳过 Redis 数据备份；本次备份不包含房间/收藏/凭据数据" >&2
fi

archive="$BACKUP_DIR/openmusic-backup-${timestamp}.tar.gz"
tar -czf "$archive" -C "$staging" .
chmod 600 "$archive"
if command -v sha256sum > /dev/null 2>&1; then
    (cd "$BACKUP_DIR" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
    chmod 600 "$archive.sha256"
    echo "SHA256：$(awk '{print $1}' "$archive.sha256")"
fi
echo "备份完成：$archive"

# 只保留最近 KEEP 份（按修改时间倒序，删更旧的归档及其校验文件）
old_backups="$(ls -1t "$BACKUP_DIR"/openmusic-backup-*.tar.gz 2>/dev/null | tail -n "+$((KEEP + 1))" || true)"
if [ -n "$old_backups" ]; then
    while IFS= read -r old; do
        rm -f "$old" "$old.sha256"
        echo "已清理旧备份：$old"
    done <<< "$old_backups"
fi

echo "恢复方法：停服后把归档解开，将 .env 与 data/ 放回部署目录，"
echo "Redis 数据解开 redis/redis-data.tar 到 redis-data 卷后再启动；详见 docs/DEPLOY.md「备份与恢复」。"
