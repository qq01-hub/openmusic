import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { generateBootstrapAdminPassword, sanitizeAdminPassword } = await import('./adminCredentials.js');

test('generateBootstrapAdminPassword 生成 20 位随机密码且避开易混淆字符', () => {
  const first = generateBootstrapAdminPassword();
  const second = generateBootstrapAdminPassword();
  assert.equal(first.length, 20);
  assert.equal(second.length, 20);
  assert.notEqual(first, second);
  assert.ok(!/[0O1lI]/.test(first), '不应包含 0/O/1/l/I');
  assert.notEqual(first, '123456');
});

test('sanitizeAdminPassword 正式口径拒绝历史默认弱密码长度', () => {
  assert.equal(sanitizeAdminPassword('123456'), null);
  assert.equal(sanitizeAdminPassword('12345678'), '12345678');
});

test('initAdminCredentials 不再以固定默认口令兜底', () => {
  const source = readFileSync(new URL('./adminCredentials.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('|| DEFAULT_PASSWORD'), '引导密码不得回退到固定默认值');
  assert.ok(source.includes('generateBootstrapAdminPassword()'), '无环境密码时应生成随机初始密码');
});
