import { cpSync, existsSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const stageDirectory = path.resolve(import.meta.dirname, '../vendor/folia');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const installOnly = process.argv.includes('--install-only');
function run(argumentsList) {
  const result = spawnSync(npmCommand, argumentsList, { cwd: stageDirectory, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync(path.join(stageDirectory, 'node_modules/.package-lock.json'))) run(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
if (!installOnly) {
  run(['run', 'build']);
  // folia 的 vite 配置把产物写到 client/public/vendor/folia（见 vendor/folia/vite.config.mjs），
  // 但大资源已外置到仓库根 static/（批 4）：构建完立刻搬过去，避免被 client 的 vite build
  // 再整包拷进 dist。URL 不变，仍由服务端按 /vendor/folia/ 托管 static/vendor/folia。
  const builtDir = path.resolve(import.meta.dirname, '../client/public/vendor/folia');
  const staticDir = path.resolve(import.meta.dirname, '../static/vendor/folia');
  if (existsSync(builtDir)) {
    rmSync(staticDir, { recursive: true, force: true });
    cpSync(builtDir, staticDir, { recursive: true });
    rmSync(builtDir, { recursive: true, force: true });
    // client/public/vendor 若已空一并清掉，避免空目录被拷进 dist
    const publicVendorDir = path.resolve(import.meta.dirname, '../client/public/vendor');
    try {
      if (existsSync(publicVendorDir) && readdirSync(publicVendorDir).length === 0) rmdirSync(publicVendorDir);
    } catch { /* 清理空目录失败不影响构建 */ }
    console.log(`[build-folia] 产物已外置 → ${staticDir}`);
  }
}
