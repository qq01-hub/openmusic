import 'dotenv/config';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMetingAssertion } from './metingAssertion.js';
import { getRuntimeConfig, setRuntimeConfig } from './runtimeConfig.js';

async function configureMeting() {
  const base = String(process.env.DOCKER_METING_URL || '').trim().replace(/\/+$/, '');
  if (!base || !process.env.DOCKER_REDIS_URL) throw new Error('缺少联合部署环境配置');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) throw new Error('Meting 配置输入过大');
  }
  const credentials = JSON.parse(input);
  const request = async (pathname, options = {}) => {
    const response = await fetch(`${base}${pathname}`, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Meting 配置请求失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (!data.success) throw new Error('Meting 配置请求未成功');
    return data;
  };

  let token = String(credentials.token || '').trim();
  if (!token) {
    const login = await request('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
    });
    if (!login.data?.token || login.require2FA) {
      throw new Error('Meting 管理登录需要人工确认，请在后台创建 API Token 并配置到 OpenMusic');
    }
    const headers = {
      'Content-Type': 'application/json',
      'X-Auth-Username': credentials.username,
      'X-Auth-Token': login.data.token,
    };
    try {
      const result = await request('/admin/tokens', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'OpenMusic joint deployment', permissions: [] }),
      });
      token = String(result.data?.token || '').trim();
      if (!token) throw new Error('Meting 未返回 API Token');
    } finally {
      await request('/admin/logout', { method: 'POST', headers });
    }
  }
  await request('/admin/check', {
    headers: {
      Authorization: `Bearer ${token}`,
      ...createMetingAssertion(token, `${base}/admin/check`),
    },
  });

  // 首次向导前建立稳定的加密主密钥，重启及向导完成时继续沿用
  if (!String(process.env.CLIENT_ID_SECRET || '').trim()) {
    const configPath = fileURLToPath(new URL('./runtimeConfig.json', import.meta.url));
    if (fs.existsSync(configPath) && fs.readFileSync(configPath, 'utf8').includes('enc:v1:')) {
      throw new Error('已有加密配置但缺少加密主密钥，请先恢复原密钥');
    }
    const envPath = fileURLToPath(new URL('./.env', import.meta.url));
    const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const secret = randomBytes(32).toString('hex');
    const next = text.replace(/^(?:export\s+)?CLIENT_ID_SECRET\s*=.*(?:\r?\n|$)/gm, '');
    fs.writeFileSync(envPath, `${next}${next && !next.endsWith('\n') ? '\n' : ''}CLIENT_ID_SECRET=${secret}\n`, { mode: 0o600 });
    fs.chmodSync(envPath, 0o600);
    process.env.CLIENT_ID_SECRET = secret;
  }
  const current = getRuntimeConfig();
  const urls = current.metingApiUrl.split(',').map(value => value.trim()).filter(Boolean);
  const auths = current.metingApiAuth.split(',').map(value => value.trim());
  const sources = urls.map((url, index) => ({
    url,
    auth: auths.length === 1 ? auths[0] : (auths[index] || ''),
  }));
  const existing = sources.find(source => {
    const url = source.url.replace(/\/+$/, '');
    return url === base || (base === 'http://meting-api:3000' && url === 'http://meting:3000');
  });
  if (existing) {
    existing.url = base;
    existing.auth = token;
  } else {
    sources.push({ url: base, auth: token });
  }
  const saved = setRuntimeConfig({ metingSources: sources });
  if (!saved.success) throw new Error('OpenMusic Meting 配置保存失败，请检查运行时配置');
  console.log('Meting API Token 已验证并加密保存，其他音源配置已保留');
}

configureMeting().catch(() => {
  console.error('Meting API Token 自动配置失败，请检查 Meting 管理凭据、双重验证、接口版本及加密主密钥，或通过两端管理后台配置令牌');
  process.exitCode = 1;
});
