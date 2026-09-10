import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWechatLoginProof,
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
