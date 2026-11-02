import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { updateError } from './core.mjs';
import { downloadRelease, extractRelease } from './release.mjs';

async function exists(file) {
  try { await fs.access(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
const managed = name => name.endsWith('.js') || ['package.json', 'package-lock.json', 'node_modules'].includes(name);

async function managedHashes(root) {
  const hashes = {};
  for (const name of (await fs.readdir(path.join(root, 'server'))).sort()) {
    if (managed(name) && name !== 'node_modules') {
      hashes[name] = createHash('sha256').update(await fs.readFile(path.join(root, 'server', name))).digest('hex');
    }
  }
  return hashes;
}
export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options, stdio: 'ignore', shell: false, windowsHide: true,
      env: { ...process.env, NODE_ENV: 'production', ...options.env },
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(updateError('UPDATE_COMMAND_FAILED', '依赖安装或进程管理操作失败，请检查服务器环境'));
    });
  });
}

export async function applySourceRelease({ root, stage, backup, journal, checkpoint, run = runCommand, health }) {
  const entries = await fs.readdir(path.join(root, 'server'));
  Object.assign(journal, { kind: 'source', root, stage, backup, runtime: entries.filter(name => !managed(name)) });
  await checkpoint('准备备份并重启源码服务');
  await run('pm2', ['stop', 'openmusic']);
  await fs.mkdir(backup, { recursive: true });
  await fs.rename(path.join(root, 'server'), path.join(backup, 'server'));
  for (const name of journal.runtime) {
    await fs.rename(path.join(backup, 'server', name), path.join(stage, 'server', name));
  }
  await fs.rename(path.join(stage, 'server'), path.join(root, 'server'));
  await fs.rename(path.join(root, 'client/dist'), path.join(backup, 'client-dist'));
  await fs.rename(path.join(stage, 'client/dist'), path.join(root, 'client/dist'));
  await checkpoint('正在启动新版本并检查服务响应');
  await run('pm2', ['restart', 'openmusic']);
  await health();
}

export async function rollbackSource(journal, run = runCommand) {
  if (journal.kind !== 'source') return;
  const { root, stage, backup, runtime } = journal;
  if (await exists(path.join(backup, 'server'))) {
    await run('pm2', ['stop', 'openmusic']);
    for (const name of runtime) {
      const old = path.join(backup, 'server', name);
      if (await exists(old)) continue;
      const live = path.join(root, 'server', name);
      const staged = path.join(stage, 'server', name);
      if (await exists(live)) await fs.rename(live, old);
      else if (await exists(staged)) await fs.rename(staged, old);
      else throw updateError('UPDATE_RECOVERY_FAILED', '原运行数据缺失，需要人工恢复');
    }
    if (await exists(path.join(root, 'server'))) {
      await fs.rename(path.join(root, 'server'), path.join(backup, 'failed-server'));
    }
    await fs.rename(path.join(backup, 'server'), path.join(root, 'server'));
  }
  if (await exists(path.join(backup, 'client-dist'))) {
    if (await exists(path.join(root, 'client/dist'))) {
      await fs.rename(path.join(root, 'client/dist'), path.join(backup, 'failed-client-dist'));
    }
    await fs.rename(path.join(backup, 'client-dist'), path.join(root, 'client/dist'));
  }
  if (Object.hasOwn(journal, 'previousVersion')) {
    const file = path.join(root, 'deployment-version.json');
    if (journal.previousVersion === null) await fs.rm(file, { force: true });
    else await fs.writeFile(file, journal.previousVersion);
  }
  await run('pm2', ['restart', 'openmusic']);
}

export function sourceExecutor({ root, directory, health, run = runCommand }) {
  return async (release, journal, checkpoint) => {
    await run('pm2', ['describe', 'openmusic']);
    const versionFile = path.join(root, 'deployment-version.json');
    const previousVersion = await exists(versionFile) ? await fs.readFile(versionFile, 'utf8') : null;
    const previous = previousVersion ? JSON.parse(previousVersion) : null;
    // 不在 Git 工作区有手工代码修改时自动覆盖
    if (previous?.managedHashes) {
      if (JSON.stringify(await managedHashes(root)) !== JSON.stringify(previous.managedHashes)) {
        throw updateError('UPDATE_LOCAL_CHANGES', '服务端代码有手工修改，请先在服务器处理');
      }
    } else if (await exists(path.join(root, '.git'))) {
      await run('git', ['diff', '--quiet', 'HEAD', '--', 'server', 'client/src'], { cwd: root });
    }
    const workspace = await fs.mkdtemp(path.join(directory, 'release-'));
    const stage = path.join(workspace, 'stage');
    const backup = path.join(workspace, 'backup');
    const archive = path.join(workspace, 'release.zip');
    await checkpoint('正在下载正式发布 ZIP');
    await downloadRelease(release, archive);
    await checkpoint('正在校验并解压升级包');
    await fs.mkdir(stage);
    await extractRelease(archive, stage);
    const packageInfo = JSON.parse(await fs.readFile(path.join(stage, 'server/package.json'), 'utf8'));
    if (packageInfo.name !== 'openmusic-server' || packageInfo.type !== 'module') {
      throw updateError('UPDATE_RELEASE_INVALID', '发布包不是兼容的 OpenMusic 服务端');
    }
    await checkpoint('正在为新版本安装生产依赖，主站仍保持运行');
    await run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: path.join(stage, 'server') });
    journal.previousVersion = previousVersion;
    await applySourceRelease({ root, stage, backup, journal, checkpoint, run, health });
    await fs.writeFile(versionFile, JSON.stringify({
      tag: release.tag, installedAt: new Date().toISOString(), managedHashes: await managedHashes(root),
    }));
  };
}
