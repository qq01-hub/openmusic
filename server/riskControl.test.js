import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiskControl, evaluateRisk, latestRiskIp } from './riskControl.js';

test('latestRiskIp returns the most recently used IP when an account has multiple IPs', () => {
  assert.equal(latestRiskIp([
    { ip: '203.0.113.10', lastSeenAt: 100 },
    { ip: '198.51.100.8', lastSeenAt: 300 },
    { ip: '192.0.2.2', lastSeenAt: 200 },
  ]), '198.51.100.8');
});

test('latestRiskIp ignores unknown and malformed entries', () => {
  assert.equal(latestRiskIp([
    { ip: 'unknown', lastSeenAt: 900 },
    { ip: '', lastSeenAt: 800 },
    { ip: '192.0.2.4', lastSeenAt: 700 },
  ]), '192.0.2.4');
});

test('new accounts reaching 500 music requests do not receive the removed burst score', () => {
  const result = evaluateRisk({
    accountAge: 60 * 60 * 1000,
    musicRequests: 500,
    requests: 500,
    operations: { url: 500 },
  });
  assert.equal(result.factors.some((factor) => factor.id === 'newAccountBurst'), false);
  assert.equal(result.reasons.includes('注册不足 24 小时且当日音乐请求达到 500'), false);
});

test('resetRisk resets one account and returns the retained latest IP', async () => {
  let evaluated;
  let scriptText = '';
  const client = {
    async hGet(_key, field) { return field === 'status' ? 'blocked' : null; },
    async eval(script, options) { scriptText = script; evaluated = options; return JSON.stringify({ found: 1, latestIp: '198.51.100.8' }); },
  };
  const control = createRiskControl({ getStore: () => client, now: () => 1_700_000_000_000 });
  const result = await control.resetRisk('acct_1234567890abcdef', { reason: '人工复核后解除误报' });
  assert.deepEqual(result, { ok: true, status: 'normal', score: 0, latestIp: '198.51.100.8', resetAt: 1_700_000_000_000 });
  assert.equal(evaluated.arguments[1], 'acct_1234567890abcdef');
  assert.equal(evaluated.arguments[2], 'blocked');
  assert.equal(evaluated.arguments[3], '人工复核后解除误报');
  assert.equal(evaluated.keys[8], 'openmusic:risk:v1:scores');
  assert.equal(scriptText.includes("redis.call('ZADD', KEYS[9], 0, ARGV[2])"), true);
});

test('mobile network switching across 4G/Wi-Fi and dual-stack IPs does not reach high risk threshold', () => {
  const mobileSwitch = evaluateRisk({
    ipCount: 6,
    musicIpCount: 3,
    musicIpChanges: 8,
    errors: 24,
    requests: 60,
    musicRequests: 30,
    roomJoins: 2,
  });
  assert.equal(mobileSwitch.score, 0);
  assert.equal(mobileSwitch.level, 'low');

  const severeRotatingProxy = evaluateRisk({
    ipCount: 16,
    musicIpCount: 5,
    musicIpChanges: 20,
    errors: 60,
    requests: 150,
    musicRequests: 120,
    roomJoins: 0,
  });
  assert.equal(severeRotatingProxy.score >= 60, true);
  assert.equal(severeRotatingProxy.level, 'high');
});

test('human check challenge rejections do not increment denied counters in consume script', async () => {
  let scriptText = '';
  const client = {
    async get() { return null; },
    async eval(script) {
      if (script.includes('ACCOUNT_HUMAN_CHECK_REQUIRED')) {
        scriptText = script;
        return ['ACCOUNT_HUMAN_CHECK_REQUIRED', 1, 1, 0, 60, 0];
      }
      return 1;
    },
  };
  const control = createRiskControl({ getStore: () => client, now: () => 1_700_000_000_000 });
  const result = await control.consume({ id: 'acct_1234567890abcdef' }, { ip: '198.51.100.8', kind: 'api' });
  assert.equal(result.code, 'ACCOUNT_HUMAN_CHECK_REQUIRED');
  assert.equal(result.allowed, false);
  const humanGateBlock = scriptText.slice(scriptText.indexOf('humanGate(KEYS[1]'));
  assert.equal(humanGateBlock.includes("HINCRBY', KEYS[1], 'denied'"), false);
  assert.equal(humanGateBlock.includes("HINCRBY', KEYS[4], 'denied'"), false);
});
