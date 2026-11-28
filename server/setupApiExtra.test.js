import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_TOKEN = 'extra-setup-token-0123456789abcdef';
process.env.SETUP_TOKEN = TEST_TOKEN;

const express = (await import('express')).default;
const { mountSetupApi, updateEnvFile } = await import('./setupApi.js');

const ENV_PATH = path.join(__dirname, '.env');

function withEnvFile(initialContent, run) {
  const backup = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : null;
  try {
    if (initialContent === null) {
      if (backup !== null) fs.unlinkSync(ENV_PATH);
    } else {
      fs.writeFileSync(ENV_PATH, initialContent, 'utf8');
    }
    run();
  } finally {
    if (backup === null) {
      if (fs.existsSync(ENV_PATH)) fs.unlinkSync(ENV_PATH);
    } else {
      fs.writeFileSync(ENV_PATH, backup, 'utf8');
    }
  }
}

test('updateEnvFile：更新已有键不破坏注释、其它键与空行', () => {
  withEnvFile('# 部署注释\nREDIS_HOST="old-host"\nOTHER_KEY=keep-me\n\nCLIENT_URL=""\n', () => {
    updateEnvFile({ REDIS_HOST: 'new host', CLIENT_URL: 'https://music.example.com' });
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    assert.match(content, /# 部署注释/);
    assert.match(content, /^OTHER_KEY=keep-me$/m);
    assert.match(content, /^REDIS_HOST="new host"$/m);
    assert.match(content, /^CLIENT_URL="https:\/\/music\.example\.com"$/m);
    assert.equal((content.match(/^REDIS_HOST=/gm) || []).length, 1, '已有键只应出现一次');
    assert.ok(content.endsWith('\n'));
  });
});

test('updateEnvFile：新键追加且重复更新不产生重复行，特殊字符被安全引用', () => {
  withEnvFile(null, () => {
    updateEnvFile({ METING_API_AUTH: 'a#b c"d' });
    updateEnvFile({ METING_API_AUTH: 'second' });
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    assert.equal((content.match(/^METING_API_AUTH=/gm) || []).length, 1);
    assert.match(content, /^METING_API_AUTH="second"$/m);
  });
  withEnvFile(null, () => {
    updateEnvFile({ TRICKY: 'a#b c"d' });
    const line = fs.readFileSync(ENV_PATH, 'utf8').trim();
    assert.equal(line, `TRICKY=${JSON.stringify('a#b c"d')}`, '含 #、空格、引号的值应以 JSON 引用写入');
  });
});

async function withSetupServer(run) {
  const app = express();
  app.use(express.json());
  mountSetupApi(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(base, pathName, body) {
  return fetch(`${base}${pathName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      Host: new URL(base).host,
      'X-Setup-Token': TEST_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

/** 与 setupToken.test.js 并行运行时，对方短暂写入 setup.lock 会让接口回 404；仅对该情形重试 */
async function postExpectingValidation(base, body) {
  let last;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    last = await post(base, '/api/setup/test-redis', body);
    if (last.status !== 404) return last;
    await last.text();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

test('test-redis 输入校验：非法主机/端口/DB/URL 在发起连接前被拒', async () => {
  await withSetupServer(async (base) => {
    const cases = [
      [{ redis: { mode: 'host', host: 'bad host!', port: 6379, database: 0 } }, /Redis 主机名无效/],
      [{ redis: { mode: 'host', host: '127.0.0.1', port: 0, database: 0 } }, /Redis 端口无效/],
      [{ redis: { mode: 'host', host: '127.0.0.1', port: 70000, database: 0 } }, /Redis 端口无效/],
      [{ redis: { mode: 'host', host: '127.0.0.1', port: 6379, database: 300 } }, /Redis DB 无效/],
      [{ redis: { mode: 'host', host: 'evil\nname', port: 6379, database: 0 } }, /Redis 主机名无效/],
      [{ redis: { mode: 'url', url: 'http://127.0.0.1:6379/0' } }, /Redis URL 必须以 redis:\/\//],
    ];
    for (const [body, pattern] of cases) {
      const res = await postExpectingValidation(base, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match((await res.json()).error, pattern, JSON.stringify(body));
    }
  });
});
