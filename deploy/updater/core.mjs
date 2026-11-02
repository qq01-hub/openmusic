import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function updateError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

const ACTIVE = new Set(['running', 'rolling_back']);

export async function createUpgradeManager({ directory, mode, current, check, execute, rollback, cleanup = async () => {} }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const statePath = path.join(directory, 'state.json');
  let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { job: null };
  let version = 'unknown';
  let latest = null;
  let checkedAt = 0;
  let checking;
  let lastCheck = 0;
  let pending = Promise.resolve();
  let lastStart = 0;
  const persist = () => {
    const temporary = `${statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temporary, statePath);
  };
  const checkpoint = async (step) => {
    if (step) state.job.step = step;
    persist();
    console.info('system-update', { mode, id: state.job.id, status: state.job.status, step: state.job.step });
  };
  async function recover() {
    if (!state.job.transaction?.kind) {
      state.job.status = 'failed';
      state.job.step = '升级准备失败，原版本继续运行';
      state.job.finishedAt = Date.now();
      persist();
      return;
    }
    state.job.status = 'rolling_back';
    await checkpoint('正在恢复升级前版本');
    try {
      await rollback(state.job.transaction);
      state.job.status = 'rolled_back';
      state.job.step = '升级未完成，已恢复原版本';
    } catch {
      state.job.status = 'recovery_required';
      state.job.step = '自动恢复失败，请通过服务器终端处理';
    }
    state.job.finishedAt = Date.now();
    persist();
    console.info('system-update', { mode, id: state.job.id, status: state.job.status, code: state.job.code });
  }
  if (state.job && ACTIVE.has(state.job.status)) await recover();
  version = await current();
  if (state.job?.status === 'succeeded') await cleanup(state.job.transaction).catch(() => {});
  const status = () => ({
    available: true, mode, currentVersion: version, latest, checkedAt,
    job: state.job ? {
      id: state.job.id, status: state.job.status, step: state.job.step,
      target: state.job.target, startedAt: state.job.startedAt, finishedAt: state.job.finishedAt,
      code: state.job.code,
    } : null,
  });
  async function checkLatest() {
    if (checking) return checking;
    if (Date.now() - checkedAt < 60_000) return status();
    if (Date.now() - lastCheck < 15_000) throw updateError('UPDATE_RATE_LIMITED', '检查过于频繁，请稍后再试', 429);
    lastCheck = Date.now();
    checking = (async () => {
      latest = await check();
      checkedAt = Date.now();
      return status();
    })();
    try { return await checking; } finally { checking = null; }
  }
  async function start(releaseId) {
    if (state.job?.status === 'recovery_required') {
      throw updateError('UPDATE_RECOVERY_REQUIRED', '请先在服务器终端恢复上次升级', 409);
    }
    if (state.job && ACTIVE.has(state.job.status)) throw updateError('UPDATE_BUSY', '已有升级任务正在执行', 409);
    if (!latest || Date.now() - checkedAt > 10 * 60_000) {
      throw updateError('UPDATE_CHECK_REQUIRED', '请先检查最新版本', 409);
    }
    if (!Number.isSafeInteger(releaseId) || latest.id !== releaseId) {
      throw updateError('UPDATE_VERSION_CHANGED', '版本信息已变化，请重新检查', 409);
    }
    if (version === latest.tag) throw updateError('UPDATE_ALREADY_CURRENT', '当前已是该版本', 409);
    if (Date.now() - lastStart < 60_000) throw updateError('UPDATE_RATE_LIMITED', '升级请求过于频繁，请稍后再试', 429);
    lastStart = Date.now();
    const selected = latest;
    state = { job: {
      id: randomUUID(), status: 'running', step: '准备升级', target: selected.tag,
      startedAt: Date.now(), transaction: {},
    } };
    persist();
    // 先持久化任务并返回 202，再执行会重启主站的操作
    pending = new Promise(resolve => setTimeout(resolve, 100)).then(async () => {
      try {
        await execute(selected, state.job.transaction, checkpoint);
        version = await current();
        state.job.status = 'succeeded';
        state.job.step = '升级完成，服务已恢复';
        state.job.finishedAt = Date.now();
        await checkpoint();
        await cleanup(state.job.transaction).catch(() => console.warn('system-update: 旧容器清理待重试'));
      } catch (error) {
        state.job.code = /^UPDATE_[A-Z_]+$/.test(error.code || '') ? error.code : 'UPDATE_EXECUTION_FAILED';
        await recover();
      }
    });
    return status();
  }
  return { status, check: checkLatest, start, finished: () => pending };
}
