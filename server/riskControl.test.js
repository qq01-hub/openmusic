import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiskControl, evaluateRisk, latestRiskIp, validateRiskPolicy } from './riskControl.js';
import { createAccountAccessMiddleware } from './accountAccess.js';
import { HUMAN_COMPLETE_SCRIPT, HUMAN_GATE_LUA } from './riskHumanChallenge.js';

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
  assert.equal(scriptText.includes('cjson.decode(rules)'), false);
  assert.equal(scriptText.includes('RISK_RULES'), true);
});

test('cross-day active room listeners and upstream-only errors do not receive false risk penalties', () => {
  const activeListener = evaluateRisk({
    requests: 650,
    musicRequests: 600,
    responseUrlOk: 600,
    socketRequests: 0,
    roomJoins: 0,
    roomContext: 1,
    errors: 120,
    clientErrors: 0,
    automationClientRequests: 0,
  });
  assert.equal(activeListener.factors.find(f => f.id === 'musicWithoutContext')?.points, 0);
  assert.equal(activeListener.factors.find(f => f.id === 'urlHarvesting')?.points, 0);
  assert.equal(activeListener.factors.find(f => f.id === 'highErrorRate')?.points, 0);

  const sharedSession = evaluateRisk({
    requests: 150,
    errors: 80,
    clientErrors: 60,
    sessionShared: 1,
  });
  assert.equal(sharedSession.factors.find(f => f.id === 'highErrorRate')?.points, 15);
  assert.equal(sharedSession.factors.find(f => f.id === 'sessionSharing')?.points, 20);
});

test('validateRiskPolicy defaults ipUrlMinuteLimit for legacy payloads and validates custom values', () => {
  const legacy = validateRiskPolicy({ minuteLimit: 600, urlMinuteLimit: 30 });
  assert.equal(legacy.ipUrlMinuteLimit, 120);
  const custom = validateRiskPolicy({ ipUrlMinuteLimit: 240 });
  assert.equal(custom.ipUrlMinuteLimit, 240);
  assert.throws(() => validateRiskPolicy({ ipUrlMinuteLimit: 0 }), /额度必须为/);
});

test('recordMusicResponse deduplicates url-window by distinct song key for url and source', async () => {
  const calls = [];
  const client = {
    async eval(script, options) {
      calls.push({ script, options });
      return 1;
    },
  };
  const control = createRiskControl({ getStore: () => client, now: () => 1_700_000_000_000 });
  await control.recordMusicResponse('acct_1234567890abcdef', {
    requestId: 'a'.repeat(32),
    at: 1_700_000_000_000,
    ip: '198.51.100.8',
    operation: 'url',
    source: 'netease',
    requestedSongId: '21038564',
    status: 200,
    durationMs: 12,
    outcome: 'ok',
    songs: [],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.arguments[9], 'netease:21038564');
  assert.equal(calls[0].script.includes("ARGV[5] == 'url' or ARGV[5] == 'source'"), true);
});

test('setDecision supports temporary block duration and rejects duration on non-blocked status', async () => {
  let capturedArgs = null;
  const client = {
    async eval(_script, options) {
      capturedArgs = options.arguments;
      return 1;
    },
  };
  const control = createRiskControl({ getStore: () => client, now: () => 1_700_000_000_000 });
  const decision = await control.setDecision('acct_1234567890abcdef', {
    status: 'blocked',
    durationMinutes: 60,
    tags: ['高频刷链'],
    note: '自动冷却',
    reason: '高频异常取链临时限制 1 小时',
  });
  assert.equal(decision.blockedUntil, 1_700_000_000_000 + 3_600_000);
  assert.equal(capturedArgs[6], String(1_700_000_000_000 + 3_600_000));
  await assert.rejects(control.setDecision('acct_1234567890abcdef', {
    status: 'watch',
    durationMinutes: 60,
    tags: [],
    note: '',
    reason: '非法组合',
  }), { code: 'RISK_DECISION_INVALID' });
});

test('human challenge removes 2-pass full-day immunity and escalates cooldown', () => {
  assert.equal(HUMAN_GATE_LUA.includes('humanPasses') && HUMAN_GATE_LUA.includes('>= 2'), false);
  assert.equal(HUMAN_GATE_LUA.includes('if not forced and triggers >= 3 then return 2 end'), true);
  assert.equal(HUMAN_COMPLETE_SCRIPT.includes('passes >= 2 and math.min(baseCooldown * 2'), true);
});

test('media-proxy continuation Range requests enforce authoritative Redis block and human challenge', async () => {
  let challengeAccountId = '';
  const createRes = () => {
    const headers = {};
    return {
      statusCode: 200,
      body: null,
      headers,
      setHeader(name, value) { headers[name] = value; },
      vary() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
      once() {},
    };
  };

  const baseAccount = { id: 'acct_1234567890abcdef', roomUserId: 'user_room_123456' };
  const blockedMiddleware = createAccountAccessMiddleware({
    resolveAccount: async () => baseAccount,
    resolveIdentity: () => ({ userId: 'user_room_123456' }),
    ensureIdentity: async () => 'user_room_123456',
    risk: {
      async consumeMediaContinuation() {
        return { allowed: false, code: 'ACCOUNT_RISK_BLOCKED', status: 403, limited: false, retryAfter: 60 };
      },
      async consume() { throw new Error('should not call full consume'); },
    },
    getIp: () => '198.51.100.8',
    withContext: (_ctx, fn) => fn(),
    metric: () => {},
    onHumanChallenge: (id) => { challengeAccountId = id; },
  });
  const reqBlocked = {
    method: 'GET',
    path: '/api/media-proxy',
    query: { url: 'https://m701.music.126.net/song.mp3' },
    headers: { range: 'bytes=1024-' },
  };
  const resBlocked = createRes();
  let nextCalled = false;
  await blockedMiddleware(reqBlocked, resBlocked, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(resBlocked.statusCode, 403);
  assert.equal(resBlocked.body?.code, 'ACCOUNT_RISK_BLOCKED');

  const humanMiddleware = createAccountAccessMiddleware({
    resolveAccount: async () => baseAccount,
    resolveIdentity: () => ({ userId: 'user_room_123456' }),
    ensureIdentity: async () => 'user_room_123456',
    risk: {
      async consumeMediaContinuation() {
        return { allowed: false, code: 'ACCOUNT_HUMAN_CHECK_REQUIRED', status: 403, limited: false, retryAfter: 60 };
      },
      async consume() { throw new Error('should not call full consume'); },
    },
    getIp: () => '198.51.100.8',
    withContext: (_ctx, fn) => fn(),
    metric: () => {},
    onHumanChallenge: (id) => { challengeAccountId = id; },
  });
  const resHuman = createRes();
  await humanMiddleware({ ...reqBlocked }, resHuman, () => { nextCalled = true; });
  assert.equal(resHuman.statusCode, 403);
  assert.equal(resHuman.body?.code, 'ACCOUNT_HUMAN_CHECK_REQUIRED');
  assert.equal(challengeAccountId, baseAccount.id);
});

test('media-proxy size=1 cover classification marks req.mediaProxyImageOnly and forwards room/device signals', async () => {
  const capturedConsume = [];
  const middleware = createAccountAccessMiddleware({
    resolveAccount: async (req) => {
      req.accountSession = { deviceMigrationRequired: true };
      return { id: 'acct_1234567890abcdef', roomUserId: 'user_room_123456' };
    },
    resolveIdentity: () => ({ userId: 'user_room_123456' }),
    ensureIdentity: async () => 'user_room_123456',
    verifyDevice: async () => ({ sessionShared: true }),
    hasRoomPresence: () => true,
    risk: {
      async consume(_account, options) {
        capturedConsume.push(options);
        return { allowed: true, code: '', requestId: 'b'.repeat(32), at: 1_700_000_000_000, status: 200, limited: false, retryAfter: 60, minute: 1, daily: 1, musicDaily: 1, score: 0 };
      },
      async recordMusicResponse() {},
      async recordOutcome() {},
    },
    getIp: () => '198.51.100.8',
    withContext: (_ctx, fn) => fn(),
    metric: () => {},
  });
  const createRes = () => ({
    statusCode: 200,
    setHeader() {},
    vary() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { return body; },
    send(body) { return body; },
    once() {},
  });

  const coverReq = {
    method: 'GET',
    path: '/api/media-proxy',
    query: { url: 'https://m701.music.126.net/song.mp3', size: '1' },
    headers: {},
  };
  await middleware(coverReq, createRes(), () => {});
  assert.equal(coverReq.mediaProxyImageOnly, true);

  const metingReq = {
    method: 'GET',
    path: '/api/meting',
    query: { server: 'netease', type: 'url', id: '21038564' },
    headers: {},
  };
  await middleware(metingReq, createRes(), () => {});
  assert.equal(capturedConsume.at(-1)?.inRoom, true);
  assert.equal(capturedConsume.at(-1)?.legacyUnbound, true);
  assert.equal(capturedConsume.at(-1)?.sessionShared, true);
});

test('切分日之后 ensureDaily 不再写 seeded 冗余键，today-requests 改为 48h TTL 且仅索引正计数账户', async () => {
  let ensureDailyCalls = 0;
  let ensureDailyScript = '';
  let consumeScript = '';
  let todayIndexScript = '';
  let statusIndexKeys = [];
  let statusIndexScript = '';
  const client = {
    async get() { return null; },
    async zCard() { return 0; },
    async zRangeWithScores() { return []; },
    async zCount() { return 0; },
    async eval(script, options) {
      if (script.includes('china-day-cutover') || options?.keys?.[3]?.endsWith('china-day-cutover')) {
        ensureDailyCalls += 1;
        ensureDailyScript = script;
        return '2026-10-27';
      }
      if (script.includes('ACCOUNT_HUMAN_CHECK_REQUIRED')) {
        consumeScript = script;
        return ['', 1, 1, 0, 0, 0];
      }
      if (options?.keys?.[0]?.endsWith('status-index:v5')) {
        statusIndexKeys = options.keys;
        statusIndexScript = script;
        return 1;
      }
      if (options?.keys?.[0]?.includes('today-index:') && script.includes('ZSCAN')) {
        return JSON.stringify({ cursor: '0', ids: ['acct_1234567890abcdef'] });
      }
      if (options?.keys?.[0]?.includes('today-requests:')) {
        todayIndexScript = script;
        return 1;
      }
      return 1;
    },
  };
  const control = createRiskControl({ getStore: () => client, now: () => Date.parse('2026-11-27T02:00:00Z') });
  await control.consume({ id: 'acct_1234567890abcdef' }, { ip: '198.51.100.8', kind: 'api' });
  await control.consume({ id: 'acct_fedcba0987654321' }, { ip: '198.51.100.9', kind: 'api' });
  assert.equal(ensureDailyCalls, 1);
  assert.equal(ensureDailyScript.includes("if cutover ~= ARGV[1] then return cutover end"), true);
  assert.equal(ensureDailyScript.includes("'native'"), false);
  assert.equal(consumeScript.includes("redis.call('EXPIRE', KEYS[25], 172800)"), true);
  assert.equal(consumeScript.includes("redis.call('EXPIRE', KEYS[25], 3024000)"), false);

  await control.list({ order: 'today' });
  assert.equal(statusIndexKeys.includes('openmusic:risk:v1:status-index:v2'), true);
  assert.equal(statusIndexScript.includes('KEYS[9]'), true);
  assert.equal(todayIndexScript.includes('if requests > 0 then redis.call(\'ZADD\', KEYS[1], requests, id) end'), true);
  assert.equal(todayIndexScript.includes("redis.call('EXPIRE', KEYS[1], 172800)"), true);
  assert.equal(todayIndexScript.includes("redis.call('SET', KEYS[2], '1', 'EX', 172800)"), true);
});
