#!/bin/sh
set -e

if [ "$(id -u)" = 0 ] && [ "${1:-}" = node ] && [ "${2:-}" = index.js ]; then
    for file in .env setup.lock runtimeConfig.json adminConfig.json setup.token; do
        target="/app/server/$file"
        if [ -e "$target" ]; then
            chown 1000:1000 "$target" 2>/dev/null || true
        fi
    done
    if [ -e /app/server/downloads ]; then
        chown -R 1000:1000 /app/server/downloads 2>/dev/null || true
    fi

    update_dir=/run/openmusic-update
    if [ -d "$update_dir" ]; then
        chgrp 1000 "$update_dir" 2>/dev/null || true
        chmod u+rwx,g+rx "$update_dir" 2>/dev/null || true
    fi
    if [ -S "$update_dir/control.sock" ]; then
        chgrp 1000 "$update_dir/control.sock" 2>/dev/null || true
        chmod ug+rw "$update_dir/control.sock" 2>/dev/null || true
    fi

    shift 2
    exec node /app/server/runAsNodeUser.mjs "$@"
fi

exec "$@"
