import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const stagingDir = path.join(root, 'dow');
const downloadDir = path.join(root, 'server', 'downloads');
const localConfigPath = path.join(root, 'desktop-build.local.json');
const runtimeConfigPath = path.join(root, 'electron', 'desktop-runtime-config.json');

export const desktopClientArtifacts = [
  { fileName: 'openmusic-desktop-setup.exe', target: 'server/downloads/openmusic-desktop-setup.exe' },
];

export function normalizeDesktopAppUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function readLocalDesktopBuildUrl() {
  try {
    const raw = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
    return normalizeDesktopAppUrl(raw?.appUrl);
  } catch {
    return null;
  }
}

function writeLocalDesktopBuildUrl(appUrl) {
  fs.writeFileSync(localConfigPath, `${JSON.stringify({ appUrl }, null, 2)}\n`, 'utf8');
  console.log(`>>> 已保存桌面客户端地址：${appUrl}`);
}

async function promptDesktopAppUrl() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('首次桌面端打包需要配置站点地址。请在交互终端执行 npm run desktop:build，或设置 OPENMUSIC_DESKTOP_URL。');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const input = await rl.question('请输入桌面客户端连接的站点地址（例如 https://music.example.com）：');
      const appUrl = normalizeDesktopAppUrl(input);
      if (appUrl) return appUrl;
      console.log('地址无效：仅支持不含账号密码的 HTTP 或 HTTPS 站点地址。');
    }
  } finally {
    rl.close();
  }
  throw new Error('站点地址配置失败，请重新执行 npm run desktop:build。');
}

async function resolveDesktopAppUrl() {
  const fromEnv = normalizeDesktopAppUrl(process.env.OPENMUSIC_DESKTOP_URL);
  if (fromEnv) {
    writeLocalDesktopBuildUrl(fromEnv);
    return fromEnv;
  }

  const fromLocal = readLocalDesktopBuildUrl();
  if (fromLocal) return fromLocal;

  const appUrl = await promptDesktopAppUrl();
  writeLocalDesktopBuildUrl(appUrl);
  return appUrl;
}

function writeRuntimeConfig(appUrl) {
  const previous = fs.existsSync(runtimeConfigPath) ? fs.readFileSync(runtimeConfigPath) : null;
  fs.writeFileSync(runtimeConfigPath, `${JSON.stringify({ appUrl })}\n`, 'utf8');
  return previous;
}

function restoreRuntimeConfig(previous) {
  if (previous) {
    fs.writeFileSync(runtimeConfigPath, previous);
    return;
  }
  if (fs.existsSync(runtimeConfigPath)) fs.unlinkSync(runtimeConfigPath);
}

const ELECTRON_PACKAGE_ATTEMPTS = 3;
const ELECTRON_PACKAGE_RETRY_DELAYS_MS = [3_000, 6_000];

export function isRetryableElectronDownloadError(error) {
  const details = [error?.message, error?.stderr, error?.stdout, error]
    .map((value) => String(value || '').toLowerCase())
    .join('\n');
  return [
    'client network socket disconnected before secure tls connection was established',
    'econnreset',
    'etimedout',
    'socket hang up',
    'network timeout',
  ].some((token) => details.includes(token));
}

function saveElectronBuilderFailureLog(error) {
  const logPath = path.join(stagingDir, 'electron-builder-error.log');
  const details = [error?.message, error?.stdout, error?.stderr]
    .filter(Boolean)
    .map((value) => String(value))
    .join('\n\n');
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(logPath, `${details}\n`, 'utf8');
  return logPath;
}

async function packageElectron() {
  const args = ['--win', 'nsis', '--publish', 'never'];
  const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');

  for (let attempt = 1; attempt <= ELECTRON_PACKAGE_ATTEMPTS; attempt += 1) {
    console.log(`>>> 正在构建 Windows 安装包（${attempt}/${ELECTRON_PACKAGE_ATTEMPTS}）…`);
    try {
      execFileSync(process.execPath, [cli, ...args], {
        cwd: root,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      return;
    } catch (error) {
      const retryable = isRetryableElectronDownloadError(error);
      if (!retryable || attempt === ELECTRON_PACKAGE_ATTEMPTS) {
        const logPath = saveElectronBuilderFailureLog(error);
        if (retryable) {
          throw new Error(`桌面安装包构建失败：下载 Electron 依赖时网络连接连续 ${attempt} 次中断。请检查网络、代理或防火墙后重试；请勿关闭 TLS 证书校验。详细日志：${logPath}`);
        }
        throw new Error(`桌面安装包构建失败。详细日志：${logPath}`);
      }

      const delayMs = ELECTRON_PACKAGE_RETRY_DELAYS_MS[attempt - 1] ?? 6_000;
      console.log(`>>> 下载依赖时网络连接中断，${Math.round(delayMs / 1000)} 秒后自动重试…`);
      await delay(delayMs);
    }
  }
}

export function publishDesktopClientArtifacts() {
  fs.mkdirSync(downloadDir, { recursive: true });
  for (const artifact of desktopClientArtifacts) {
    const source = path.join(stagingDir, artifact.fileName);
    const destination = path.join(root, artifact.target);
    if (!fs.existsSync(source)) {
      throw new Error(`桌面客户端产物缺失：${source}`);
    }
    fs.copyFileSync(source, destination);
    console.log(`>>> 已发布桌面客户端：${artifact.target}`);
  }
}

async function main() {
  const appUrl = await resolveDesktopAppUrl();
  const previousRuntimeConfig = writeRuntimeConfig(appUrl);
  try {
    await packageElectron();
    publishDesktopClientArtifacts();
  } finally {
    restoreRuntimeConfig(previousRuntimeConfig);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error) => {
    console.error(`>>> ${error?.message || '桌面安装包构建失败。'}`);
    process.exitCode = 1;
  });
}
