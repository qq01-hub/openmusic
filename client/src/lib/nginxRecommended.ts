/** 首次部署完成后展示的 Nginx location 片段：静态直出 + 动态回 Node */

const DEFAULT_APP_ROOT = '/www/openmusic';

const NGINX_LOCATIONS = String.raw`# 静态 Nginx 直出，动态回 Node（把下面的 location 放进站点 server 块）
# 前端目录：__APP_ROOT__/client/dist   后端：127.0.0.1:4000
# ★ 删掉原来的 location / { proxy_pass 4000; }，改成末尾的动态路由 + 404 回退
# 保存后执行：nginx -t && nginx -s reload

location /socket.io/ {
    proxy_pass http://127.0.0.1:4000/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    proxy_buffering off;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}

# 必须写在 /api/ 前面：音频 Range 流式转发
location ^~ /api/media-proxy {
    proxy_cache off;
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_max_temp_file_size 0;
    proxy_force_ranges on;
    gzip off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location ^~ /api/ {
    proxy_cache off;
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    proxy_connect_timeout 60s;
    proxy_send_timeout 600s;
    proxy_read_timeout 600s;
}

location ^~ /downloads/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}

location ^~ /wx-proxy {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}

location ^~ /cgi-bin/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}

location = /robots.txt {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}

location = /sitemap.xml {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}

# 首页 HTML 走 Node，保证百度验证 meta 出现在源码里（格式与平台一致）
location = / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}

location = /index.html {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}

# 动态会话页由 Node 返回 X-Robots-Tag: noindex，避免被收录
location ^~ /room/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}

location ^~ /tv/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}

# /admin 与自定义后台入口由 Node 校验；随机后台路径经下方 @openmusic_not_found 进入 Node 并返回 200
location = /admin {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}

# 静态直出（构建产物带 content hash，可长期缓存；预压缩 .gz 直接复用）
location ^~ /assets/ {
    gzip_static on;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    access_log off;
    try_files $uri =404;
}

location ^~ /qface/ {
    gzip_static on;
    expires 365d;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    access_log off;
    try_files $uri =404;
}

# Sonic Workshop 在 sandbox 的 opaque origin 内加载 ES module；仅允许 Origin: null，且不允许凭据
location ^~ /vendor/sonic-workshop/ {
    gzip_static on;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000" always;
    add_header Access-Control-Allow-Origin "null" always;
    access_log off;
    try_files $uri =404;
}

location ^~ /vendor/folia/assets/ {
    gzip_static on;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    access_log off;
    try_files $uri =404;
}

location ^~ /vendor/folia/ {
    expires -1;
    add_header Cache-Control "no-cache, must-revalidate" always;
    access_log off;
    try_files $uri =404;
}

location ^~ /vendor/ {
    gzip_static on;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000" always;
    access_log off;
    try_files $uri =404;
}

location = /favicon.svg {
    gzip_static on;
    expires 7d;
    add_header Cache-Control "public, max-age=604800" always;
    access_log off;
}

location = /favicon.ico {
    expires 7d;
    add_header Cache-Control "public, max-age=604800" always;
    access_log off;
}

location = /apple-touch-icon.png {
    expires 7d;
    add_header Cache-Control "public, max-age=604800" always;
    access_log off;
}

location = /site.webmanifest {
    expires 7d;
    add_header Cache-Control "public, max-age=604800" always;
    access_log off;
    default_type application/manifest+json;
}

location = /og-cover.png {
    expires 7d;
    add_header Cache-Control "public, max-age=604800" always;
    access_log off;
}

# 未知路径保持 404 状态，同时交给前端展示 404 页面
location / {
    error_page 404 = @openmusic_not_found;
    try_files $uri $uri/ =404;
}

location @openmusic_not_found {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header EO-Connecting-IP $http_eo_connecting_ip;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header iqp $http_iqp;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
}
`;

export function buildRecommendedNginxConfig(options: {
  siteUrl?: string;
  appRoot?: string;
} = {}): string {
  const appRoot = String(options.appRoot || DEFAULT_APP_ROOT).replace(/\/+$/, '') || DEFAULT_APP_ROOT;
  return NGINX_LOCATIONS.split('__APP_ROOT__').join(appRoot);
}
