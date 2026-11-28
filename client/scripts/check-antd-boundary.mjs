#!/usr/bin/env node
// 守住 antd 的引入边界：antd/@ant-design 系列包体积很大（打包后约 900KB），
// 目前只有后台管理页（Admin/Setup 及其子组件）依赖它，且它们本身是懒加载的，
// 不会拖慢普通听歌用户的首屏。这个脚本防止以后有人在房间/大厅等主站页面
// 不小心引入 antd 组件，把这坨体积带进主站主 chunk。
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const srcDir = join(__dirname, '..', 'src');

// --dist 模式：只查构建产物。源码 import 干净不等于首屏干净——共享底层模块
// （如 @babel/runtime helper）若被 Rollup 并进 antd-vendor，所有用到它的 chunk
// 都会静态 import antd-vendor 并被写进 dist/index.html 的 modulepreload，
// 普通用户首屏照样要下载整坨 antd。这条检查必须在 build 之后跑（见 build:check）。
if (process.argv.includes('--dist')) {
  const distIndex = join(__dirname, '..', 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    console.error(`未找到 ${distIndex}，请先执行 npm run build 再跑产物检查。`);
    process.exit(1);
  }
  const html = readFileSync(distIndex, 'utf8');
  const preloadHrefs = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const antdPreloads = preloadHrefs.filter((href) => href.includes('antd'));
  if (antdPreloads.length > 0) {
    console.error('构建产物首屏 modulepreload 混入了 antd chunk（普通用户不该预加载 antd）：');
    for (const href of antdPreloads) console.error(`  - ${href}`);
    console.error('\n多半是共享底层模块被并进了 antd-vendor chunk，请检查 vite.config.ts 的 manualChunks 分桶。');
    process.exit(1);
  }
  console.log(`antd 产物边界检查通过（首屏 modulepreload 共 ${preloadHrefs.length} 项，无 antd）。`);
  process.exit(0);
}

const ALLOWED_PREFIXES = [
  'pages/admin/',
  'pages/Admin.tsx',
  'pages/Setup.tsx',
];

const ANTD_IMPORT_RE = /from\s+['"](antd|@ant-design\/[^'"]+)['"]/;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

function isAllowed(relPath) {
  return ALLOWED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

const violations = [];
for (const file of walk(srcDir)) {
  const relPath = relative(srcDir, file).replace(/\\/g, '/');
  if (isAllowed(relPath)) continue;
  const content = readFileSync(file, 'utf8');
  if (ANTD_IMPORT_RE.test(content)) {
    violations.push(relPath);
  }
}

if (violations.length > 0) {
  console.error('发现 antd/@ant-design 引入越界（应只出现在后台管理页 pages/admin/、pages/Admin.tsx、pages/Setup.tsx 下）：');
  for (const file of violations) console.error(`  - src/${file}`);
  console.error('\n这会把 antd 这个大依赖打进主站普通用户会加载的 chunk 里，请改用轻量组件或把这块逻辑挪进后台目录。');
  process.exit(1);
}

console.log('antd 引入边界检查通过。');
