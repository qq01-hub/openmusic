import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { createDeploymentArchive } from './deployment-archive.mjs';
import { assertBuildMemory, getBuildEnvironment } from './build-resources.mjs';
import {
  mergeReleaseNotes,
  parseForcePrompt,
  parseNotesFromEnv,
  readReleaseNotesFile,
  writeReleaseNotesFile,
} from './app-version.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'release', 'openmusic');
const archivePath = path.join(root, 'release', 'openmusic-build.zip');

const SERVER_STATIC = [
  'package.json',
  'package-lock.json',
  '.env.example',
];

function getServerFiles() {
  const serverDir = path.join(root, 'server');
  const jsFiles = fs
    .readdirSync(serverDir)
    .filter((name) => name.endsWith('.js'))
    .sort();
  return [...jsFiles, ...SERVER_STATIC.filter((name) => fs.existsSync(path.join(serverDir, name)))];
}

function rm(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function askLine(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(String(answer || '').trim()));
  });
}

/**
 * @param {import('readline').Interface} rl
 * @param {boolean} current
 */
async function askForcePrompt(rl, current) {
  const hint = current ? 'Y/n' : 'y/N';
  const answer = await askLine(rl, `是否强制提示用户更新？(${hint}) `);
  if (!answer) return current;
  return parseForcePrompt(answer);
}

/** 打包前录入更新说明，写入 release-notes.json 供构建注入 */
async function collectReleaseNotes() {
  const existing = readReleaseNotesFile();
  const envForce = process.env.RELEASE_FORCE_PROMPT;
  const forceFromEnv = envForce !== undefined && envForce !== ''
    ? parseForcePrompt(envForce)
    : null;
  const appendFromEnv = process.env.RELEASE_NOTES_APPEND !== undefined
    ? parseForcePrompt(process.env.RELEASE_NOTES_APPEND)
    : false;

  if (process.env.RELEASE_NOTES) {
    const notes = parseNotesFromEnv(process.env.RELEASE_NOTES);
    const finalNotes = mergeReleaseNotes(existing.notes, notes, appendFromEnv);
    const forcePrompt = forceFromEnv ?? existing.forcePrompt;
    const saved = writeReleaseNotesFile(finalNotes, { forcePrompt });
    console.log(`>>> 强制提示: ${saved.forcePrompt ? '是' : '否'}`);
    return saved;
  }

  if (!isInteractive() || process.env.RELEASE_NOTES_SKIP === '1') {
    console.log('>>> 非交互环境，使用现有 release-notes.json');
    const notes = existing.notes.length ? existing.notes : ['功能与体验优化'];
    const forcePrompt = forceFromEnv ?? existing.forcePrompt;
    const saved = writeReleaseNotesFile(notes, { forcePrompt });
    console.log(`>>> 强制提示: ${saved.forcePrompt ? '是' : '否'}`);
    return saved;
  }

  console.log('');
  console.log('>>> 本次更新说明（强制提示时用户会看到）');
  if (existing.notes.length) {
    console.log('当前 release-notes.json：');
    existing.notes.forEach((note, index) => console.log(`  ${index + 1}. ${note}`));
    console.log(`  强制提示: ${existing.forcePrompt ? '是' : '否'}`);
  }
  console.log('每行一条，空行结束；直接回车保留现有内容。');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const notes = [];
  let forcePrompt = forceFromEnv ?? existing.forcePrompt;
  let appendPrevious = false;
  try {
    if (existing.notes.length) {
      const appendAnswer = await askLine(rl, '是否延续之前的更新记录续写？(y/N) ');
      appendPrevious = parseForcePrompt(appendAnswer);
    }
    for (let i = 0; i < 12; i += 1) {
      const line = await askLine(rl, `  ${i + 1}. `);
      if (!line) break;
      notes.push(line);
    }
    if (forceFromEnv === null) {
      forcePrompt = await askForcePrompt(rl, existing.forcePrompt);
    }
  } finally {
    rl.close();
  }

  const finalNotes = notes.length > 0
    ? mergeReleaseNotes(existing.notes, notes, appendPrevious)
    : (existing.notes.length ? existing.notes : ['功能与体验优化']);
  if (notes.length === 0) {
    console.log('>>> 未输入新说明，保留现有内容');
  } else if (appendPrevious) {
    console.log(`>>> 已续写 ${notes.length} 条更新说明，历史记录共 ${finalNotes.length} 条`);
  } else {
    console.log(`>>> 已写入 ${notes.length} 条更新说明`);
  }

  const saved = writeReleaseNotesFile(finalNotes, { forcePrompt });
  console.log(`>>> 强制提示: ${saved.forcePrompt ? '是' : '否（静默发版，不弹窗）'}`);
  return saved;
}

assertBuildMemory();
await collectReleaseNotes();

console.log('>>> 构建前端...');
execSync('npm run build', { cwd: root, stdio: 'inherit', env: getBuildEnvironment() });

console.log('>>> 组装部署目录...');
rm(outDir);
fs.mkdirSync(path.join(outDir, 'server'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'client', 'dist'), { recursive: true });

for (const file of getServerFiles()) {
  const src = path.join(root, 'server', file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outDir, 'server', file));
  }
}

copyDir(path.join(root, 'client', 'dist'), path.join(outDir, 'client', 'dist'));

const clientEnvExample = path.join(root, 'client', '.env.example');
if (fs.existsSync(clientEnvExample)) {
  fs.copyFileSync(clientEnvExample, path.join(outDir, 'client', '.env.example'));
}

copyDir(path.join(root, 'deploy'), path.join(outDir, 'deploy'));

const releaseNotesSrc = path.join(root, 'release-notes.json');
if (fs.existsSync(releaseNotesSrc)) {
  fs.copyFileSync(releaseNotesSrc, path.join(outDir, 'release-notes.json'));
}

fs.writeFileSync(
  path.join(outDir, 'README-DEPLOY.txt'),
  `OpenMusic 宝塔部署包

1. 上传本目录到服务器，例如 /www/wwwroot/openmusic
2. cd /www/wwwroot/openmusic/server
3. cp .env.example .env 并编辑配置（PORT、METING_API_URL、CLIENT_URL 填你的域名）
4. npm install --production
5. pm2 start ../deploy/ecosystem.config.cjs
6. 宝塔 Nginx 参考 deploy/nginx.conf.example（静态直出 + 仅 API/WS 反代）

发版后若使用 EdgeOne：
- 建议对 /api/*、/index.html、/version.json 关闭缓存或设为动态
- 或发版后刷新 EdgeOne 缓存（至少刷新 HTML）
- 前端资源已带 content hash，旧 JS 不会被误当成新版

详细说明见 deploy/DEPLOY-BAOTA.md
`,
  'utf8',
);

console.log('>>> 打包 zip...');
createDeploymentArchive(outDir, archivePath);

const versionPath = path.join(outDir, 'client', 'dist', 'version.json');
if (fs.existsSync(versionPath)) {
  console.log('');
  console.log('版本信息:', fs.readFileSync(versionPath, 'utf8').trim());
}

console.log('');
console.log('✅ 打包完成');
console.log('   目录:', outDir);
console.log('   压缩包:', archivePath);
