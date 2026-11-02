import http from 'node:http';

export function requestUpdater(operation, body) {
  const socketPath = process.env.OPENMUSIC_UPDATE_SOCKET;
  if (!socketPath) {
    if (operation === 'status') return Promise.resolve({
      available: false, mode: 'unmanaged', currentVersion: process.env.OPENMUSIC_RELEASE_VERSION || 'unknown',
      reason: '尚未接入升级服务，请按部署文档完成一次升级服务安装',
      latest: null, job: null,
    });
    return Promise.reject(Object.assign(new Error('尚未接入升级服务'), { status: 503, code: 'UPDATE_UNAVAILABLE' }));
  }
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const request = http.request({
      socketPath, path: `/${operation}`, method: operation === 'status' ? 'GET' : 'POST',
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, response => {
      let text = '';
      response.on('data', chunk => {
        text += chunk;
        if (Buffer.byteLength(text) > 64 * 1024) request.destroy(new Error('response too large'));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const result = JSON.parse(text);
          if (response.statusCode >= 400) reject(Object.assign(new Error(result.error), { status: response.statusCode, code: result.code }));
          else resolve(result);
        } catch { reject(new Error('invalid update response')); }
      });
    });
    request.setTimeout(30_000, () => request.destroy(new Error('updater timeout')));
    request.on('error', () => reject(Object.assign(new Error('升级服务连接失败，请检查升级服务是否运行'), {
      status: 503, code: 'UPDATE_UNAVAILABLE',
    })));
    request.end(data);
  });
}

export function mountSystemUpgradeApi(app, { requireAdmin, requireAdminOrigin, requireAdminSetupComplete, audit, getClientIp }) {
  const call = operation => async (req, res) => {
    const ip = getClientIp?.(req) || req.ip || '';
    if (operation === 'upgrade' && (!req.body || Object.keys(req.body).some(key => key !== 'releaseId')
      || !Number.isSafeInteger(req.body.releaseId) || req.body.releaseId <= 0)) {
      return res.status(400).json({ code: 'UPDATE_INVALID_INPUT', error: '请先检查并选择正式发布版本' });
    }
    try {
      const result = await requestUpdater(operation, operation === 'upgrade' ? { releaseId: req.body.releaseId } : undefined);
      if (operation === 'upgrade') audit('system_upgrade_start', { target: result.job?.target, mode: result.mode }, ip);
      res.status(operation === 'upgrade' ? 202 : 200).json(result);
    } catch (error) {
      if (operation === 'upgrade') audit('system_upgrade_rejected', { code: error.code || 'UPDATE_UNAVAILABLE' }, ip);
      res.status(error.status || 503).json({ code: error.code || 'UPDATE_UNAVAILABLE', error: error.message });
    }
  };
  app.get('/api/admin/system-upgrade', requireAdmin, call('status'));
  app.post('/api/admin/system-upgrade/check', requireAdmin, requireAdminOrigin, requireAdminSetupComplete, call('check'));
  app.post('/api/admin/system-upgrade', requireAdmin, requireAdminOrigin, requireAdminSetupComplete, call('upgrade'));
}
