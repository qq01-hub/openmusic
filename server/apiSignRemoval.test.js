import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// API 签名模块已删除：客户端从未真正计算过签名（signApiUrl 只做会话门禁，
// 且 deriveApiSignKey 依赖服务端独有密钥、bootstrap 从不下发签名密钥），
// 服务端 verifyApiSign 也从未接线。授权一律以 HttpOnly 会话 Cookie 与
// 服务端会话校验为准，本测试防止死模块与假开关被重新引入。
test('apiSign 死模块与 API_SIGN_REQUIRED 假开关不得回流', () => {
  assert.equal(fs.existsSync(path.join(__dirname, 'apiSign.js')), false);
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.equal(indexSource.includes('apiSign'), false);
  assert.equal(indexSource.includes('API_SIGN_REQUIRED'), false);
  assert.equal(indexSource.includes('X-OM-Sign'), false);
});
