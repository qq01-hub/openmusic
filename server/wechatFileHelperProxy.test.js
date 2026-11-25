import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimWechatLoginProof,
  createWechatLoginProof,
  mountWechatFileHelperProxy,
  verifyWechatLoginProof,
  WECHAT_LOGIN_PROOF_TTL_SEC,
} from './wechatFileHelperProxy.js';

test('微信扫码证明只能由服务端签发并包含短期身份信息', () => {
  const issuedAt = Date.now();
  const token = createWechatLoginProof('001234567890', {
    now: () => issuedAt,
    nonce: () => 'fixed-test-nonce',
  });
  const proof = verifyWechatLoginProof(token);
  assert.equal(proof.uin, '001234567890');
  assert.equal(proof.nonce, 'fixed-test-nonce');
  assert.equal(proof.exp, Math.floor(issuedAt / 1000) + WECHAT_LOGIN_PROOF_TTL_SEC);
  assert.equal(verifyWechatLoginProof(`${token}tampered`), null);
});

test('微信登录证明只能成功消费一次，并以证明中的 UIN 为准', async () => {
  const proof = verifyWechatLoginProof(createWechatLoginProof('001234567890', {
    nonce: () => 'single-use-test-nonce',
  }));
  const claimedKeys = new Set();
  const store = {
    async set(key, value, options) {
      assert.equal(value, '1');
      assert.equal(options.NX, true);
      assert.equal(options.EX, WECHAT_LOGIN_PROOF_TTL_SEC);
      if (claimedKeys.has(key)) return null;
      claimedKeys.add(key);
      return 'OK';
    },
  };

  const first = await claimWechatLoginProof(proof, store);
  assert.equal(first.uin, '001234567890');
  assert.equal(await claimWechatLoginProof(proof, store), null);
});

test('微信文件助手代理按账号租户隔离登录 Cookie 池，避免跨账号串用', async () => {
  const routes = [];
  const mockApp = {
    use(prefix, handler) {
      routes.push({ prefix, handler });
    },
  };
  const upstreamCookiesSeen = [];
  const mockFetch = async (url, init) => {
    if (String(url).includes('webwxnewloginpage')) {
      const headers = new Headers({ 'content-type': 'application/xml' });
      headers.getSetCookie = () => [
        'wxsid=shared-sid-1; Path=/',
        'wxuin=99887766; Path=/',
        'webwx_data_ticket=tenant-a-secret-ticket; Path=/',
      ];
      return {
        status: 200,
        headers,
        arrayBuffer: async () => Buffer.from('<error><ret>0</ret><wxsid>shared-sid-1</wxsid><wxuin>99887766</wxuin></error>'),
      };
    }
    upstreamCookiesSeen.push(init?.headers?.Cookie || '');
    return {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => Buffer.from('{"BaseResponse":{"Ret":0}}'),
    };
  };

  mountWechatFileHelperProxy(mockApp, mockFetch, {
    requireAuth: (req) => {
      req.wxProxyTenantId = req.headers['x-test-tenant'];
      return true;
    },
  });
  const wxProxyHandler = routes.find((route) => route.prefix === '/wx-proxy').handler;

  const invoke = async (req) => new Promise((resolve) => {
    const res = {
      headersSent: false,
      statusCode: 200,
      headers: new Map(),
      set(key, value) { this.headers.set(String(key).toLowerCase(), value); },
      setHeader(key, value) { this.headers.set(String(key).toLowerCase(), value); },
      append() {},
      type() { return this; },
      status(code) { this.statusCode = code; return this; },
      send(body) { this.headersSent = true; resolve({ statusCode: this.statusCode, body }); },
      end(body) { this.headersSent = true; resolve({ statusCode: this.statusCode, body }); },
    };
    wxProxyHandler(req, res);
  });

  await invoke({
    method: 'GET',
    originalUrl: '/wx-proxy/https://szfilehelper.weixin.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?ticket=1',
    headers: { 'x-test-tenant': 'account-a' },
  });
  await invoke({
    method: 'POST',
    originalUrl: '/wx-proxy/https://szfilehelper.weixin.qq.com/cgi-bin/mmwebwx-bin/webwxinit',
    headers: { 'x-test-tenant': 'account-a', cookie: 'wxsid=shared-sid-1; wxuin=99887766' },
    body: Buffer.from('{}'),
  });
  await invoke({
    method: 'POST',
    originalUrl: '/wx-proxy/https://szfilehelper.weixin.qq.com/cgi-bin/mmwebwx-bin/webwxinit',
    headers: { 'x-test-tenant': 'account-b', cookie: 'wxsid=shared-sid-1; wxuin=99887766' },
    body: Buffer.from('{}'),
  });

  assert.match(upstreamCookiesSeen[0], /webwx_data_ticket=tenant-a-secret-ticket/);
  assert.doesNotMatch(upstreamCookiesSeen[1], /tenant-a-secret-ticket/);
});
