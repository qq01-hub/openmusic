import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicApiPath } from './apiSign.js';

test('普通用户账户认证接口绕过匿名会话签名门槛', () => {
  for (const path of [
    '/api/auth/email/code',
    '/api/auth/email/register',
    '/api/auth/email/login',
    '/api/auth/logout',
    '/api/auth/wechat/account',
  ]) {
    assert.equal(isPublicApiPath({ path, method: 'POST' }), true, path);
  }
  assert.equal(isPublicApiPath({ path: '/api/auth/session', method: 'GET' }), true);
  assert.equal(isPublicApiPath({ path: '/api/auth/providers', method: 'GET' }), true);
  assert.equal(isPublicApiPath({ path: '/api/auth/email/login', method: 'GET' }), false);
});
