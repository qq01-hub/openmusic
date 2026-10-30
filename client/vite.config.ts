import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { compression } from 'vite-plugin-compression2';
import { constants as zlibConstants } from 'node:zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  applySeoToHtml,
  buildRobotsTxt,
  buildSitemapXml,
  resolveDevSiteOrigin,
  resolvePrimarySiteOrigin,
} from '../server/seoFiles.js';
import { buildAppVersionMeta, writeVersionJson } from '../scripts/app-version.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appVersionMeta = buildAppVersionMeta();
// 生产静态资源默认生成 Brotli/Gzip，Node 直出时也能复用，部署到 Nginx 时可直接忽略。
const shouldPrecompress = process.env.OPENMUSIC_PRECOMPRESS !== 'false';

/** 构建期规范主域：优先 SITE_CANONICAL_URL，否则 CLIENT_URL 首项 */
const BUILD_SITE_ORIGIN = resolvePrimarySiteOrigin(
  process.env.CLIENT_URL || '',
  process.env.SITE_CANONICAL_URL || '',
);

function seoDevMiddleware() {
  return {
    name: 'openmusic-seo-dev',
    enforce: 'pre' as const,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0];
        if (pathname !== '/sitemap.xml' && pathname !== '/robots.txt') {
          next();
          return;
        }

        const origin = resolveDevSiteOrigin(req);
        const body = pathname === '/robots.txt' ? buildRobotsTxt(origin) : buildSitemapXml(origin);
        res.setHeader('Content-Type', pathname === '/robots.txt' ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8');
        res.end(body);
      });
    },
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string, ctx: { server?: unknown }) {
        // 仅开发服务器替换；生产构建交给 seoBuildPlugin，避免写成 localhost
        if (!ctx.server) return html;
        return applySeoToHtml(html, {
          siteOrigin: resolveDevSiteOrigin({ headers: { host: 'localhost:5173' } }),
          baiduVerification: process.env.SITE_BAIDU_VERIFICATION || '',
        });
      },
    },
  };
}

/** 构建产物写入 version.json，供 /api/app-version 与更新检测使用 */
function appVersionPlugin(): Plugin {
  return {
    name: 'openmusic-app-version',
    apply: 'build',
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir || path.join(__dirname, 'dist');
      const filePath = writeVersionJson(outDir, appVersionMeta);
      console.log(`[app-version] ${appVersionMeta.buildId} → ${filePath}`);
      console.log(`  forcePrompt: ${appVersionMeta.forcePrompt ? 'yes' : 'no'}`);
      if (appVersionMeta.notes.length) {
        for (const note of appVersionMeta.notes) {
          console.log(`  - ${note}`);
        }
      }
    },
  };
}

/** 生产构建：绝对 URL 注入 + 静态 robots/sitemap 托底 */
function seoBuildPlugin(): Plugin {
  return {
    name: 'openmusic-seo-build',
    apply: 'build',
    transformIndexHtml(html) {
      console.log(BUILD_SITE_ORIGIN
        ? `[seo] site origin → ${BUILD_SITE_ORIGIN}`
        : '[seo] SITE_CANONICAL_URL 未配置；静态产物不写入固定规范域。');
      const withSeo = applySeoToHtml(html, {
        siteOrigin: BUILD_SITE_ORIGIN,
        baiduVerification: process.env.SITE_BAIDU_VERIFICATION || '',
      });
      return withSeo;
    },
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir || path.join(__dirname, 'dist');
      if (!BUILD_SITE_ORIGIN) return;
      fs.writeFileSync(path.join(outDir, 'robots.txt'), buildRobotsTxt(BUILD_SITE_ORIGIN), 'utf8');
      fs.writeFileSync(path.join(outDir, 'sitemap.xml'), buildSitemapXml(BUILD_SITE_ORIGIN), 'utf8');
      console.log(`[seo] wrote robots.txt & sitemap.xml → ${BUILD_SITE_ORIGIN}`);
    },
  };
}

function qfaceDevCachePlugin(): Plugin {
  return {
    name: 'openmusic-qface-dev-cache',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] || '';
        if (pathname.startsWith('/qface/')) {
          // 开发态也给长缓存，避免刷新表情弹框反复拉 APNG
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        next();
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(appVersionMeta.buildId),
    __APP_VERSION_NOTES__: JSON.stringify(appVersionMeta.notes),
  },
  plugins: [
    react(),
    seoDevMiddleware(),
    qfaceDevCachePlugin(),
    seoBuildPlugin(),
    appVersionPlugin(),
    ...(shouldPrecompress
      ? [compression({
          threshold: 1024,
          algorithms: [
            ['gzip', { level: 6 }],
            ['brotliCompress', { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5, [zlibConstants.BROTLI_PARAM_LGWIN]: 20 } }],
          ],
          scheduler: { limit: 1, isHighMemory: () => true },
          skipIfLargerOrEqual: true,
        })]
      : []),
  ],
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    reportCompressedSize: false,
    // AntD 仅由后台路由懒加载；稳定 vendor 约 937KB minified / 301KB gzip。
    chunkSizeWarningLimit: 950,
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            if (
              id.includes('/components/Chat')
              || id.includes('/components/Sticker')
              || id.includes('/components/UserSticker')
              || id.includes('/lib/chat')
              || id.includes('/lib/qface')
              || id.includes('/stores/chat')
            ) {
              return 'chat-ui';
            }
            if (id.includes('/components/queue/') || id.includes('/components/QueuePanel')) {
              return 'queue-ui';
            }
            return;
          }
          if (id.includes('/echarts/') || id.includes('/zrender/')) {
            return 'admin-charts';
          }
          if (id.includes('@ant-design/icons')) {
            return 'antd-icons';
          }
          if (id.includes('antd/locale')) {
            return 'antd-locale';
          }
          if (id.includes('/antd/es/')) {
            // AntD 内部组件互相引用，按组件名拆桶会形成循环 chunk；保持单一稳定 vendor。
            return 'antd-vendor';
          }
          if (id.includes('@react-three')) {
            return 'react-three-vendor';
          }
          if (id.includes('/three/')) {
            return 'three-vendor';
          }
          if (id.includes('@mediapipe')) {
            return 'mediapipe-vendor';
          }
          if (id.includes('socket.io-client')) {
            return 'socket-vendor';
          }
          if (id.includes('lucide-react')) {
            return 'icons-vendor';
          }
          if (id.includes('zustand')) {
            return 'zustand-vendor';
          }
          if (id.includes('react-window')) {
            return 'window-vendor';
          }
          if (
            id.includes('react-dom')
            || id.includes('react-router')
            || /[/\\]react[/\\]/.test(id)
          ) {
            return 'react-vendor';
          }
        },
      },
    },
  },
  esbuild: {
    drop: ['debugger'],
    legalComments: 'none',
  },
  optimizeDeps: {
    // 仅以应用入口 index.html 作为扫描起点：默认的 **/*.html 会连带扫描
    // public/vendor 下由 Wallpaper Engine 预打包的成品 JS（内部含可选
    // require('@emotion/is-prop-valid')），冷启动预构建时会直接报依赖缺失。
    entries: ['index.html'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
      '/wx-proxy': { target: 'http://localhost:4000', changeOrigin: false },
      '/cgi-bin': { target: 'http://localhost:4000', changeOrigin: false },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
