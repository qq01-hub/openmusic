import { HUMAN_GATE_LUA, HUMAN_COMPLETE_SCRIPT, humanChallengeSnapshot } from './riskHumanChallenge.js';
import { riskChallengeChannel } from './riskChallengeBus.js';
import { getRuntimeConfig } from './runtimeConfig.js';
import { evalRedisScript } from './redisScripts.js';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { getRedisClient } from './roomStorage.js';
import { normalizeRiskError } from './riskErrors.js';
import { normalizeMusicResponseEvent, summarizeMusicSamples } from './riskMusicResponse.js';

const DAY = 86_400_000;
const CHINA_OFFSET = 8 * 60 * 60 * 1000;
const HISTORY_SEC = 90 * 86_400;
const DEFAULT_POLICY = Object.freeze({
  minuteLimit: 600,
  dayLimit: 50_000,
  musicMinuteLimit: 120,
  musicDayLimit: 10_000,
  ipMinuteLimit: 3_000,
  urlMinuteLimit: 30,
  urlBurstLimit: 8,
});
const STATUSES = new Set(['normal', 'watch', 'blocked']);
const ACCOUNT_PATTERN = /^acct_[a-zA-Z0-9_-]{16,64}$/u;

export class RiskControlError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function accountId(value) {
  if (!ACCOUNT_PATTERN.test(String(value || ''))) throw new RiskControlError('RISK_ACCOUNT_INVALID', '账户标识无效', 400);
  return String(value);
}

function cleanIp(value) {
  const ip = String(value || '').trim();
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6 || ip.includes('%')) return 'unknown';
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = normalized.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/u);
  if (!mapped) return normalized;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function latestRiskIp(entries) {
  return entries
    .filter(entry => entry && typeof entry.ip === 'string' && isIP(entry.ip) && entry.ip !== 'unknown')
    .sort((left, right) => Number(right.lastSeenAt || 0) - Number(left.lastSeenAt || 0))[0]?.ip || '';
}

export function validateRiskPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RiskControlError('RISK_POLICY_INVALID', '风控额度无效', 400);
  for (const [name, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_POLICY, name) || !Number.isSafeInteger(value) || value < 1 || value > 10_000_000) {
      throw new RiskControlError('RISK_POLICY_INVALID', '额度必须为 1 至 10000000 的整数，且不能包含未知字段', 400);
    }
  }
  return { ...DEFAULT_POLICY, ...input };
}

export const riskDate = timestamp => new Date(timestamp + CHINA_OFFSET).toISOString().slice(0, 10);
export const riskDayRemaining = timestamp => Math.ceil((DAY - (timestamp + CHINA_OFFSET) % DAY) / 1000);

const MUSIC_OPERATIONS = ['url', 'search', 'lrc', 'song', 'playlist', 'search_playlist', 'fm', 'source', 'media'];

const RULES = [
  { id: 'denied', label: '当日多次触发额度或封禁', threshold: 10, points: 30, highThreshold: 100, highPoints: 50 },
  { id: 'ipCount', label: '近 24 小时使用多个访问 IP', threshold: 5, points: 20, highThreshold: 10, highPoints: 30 },
  { id: 'minutePeak', label: '当日请求存在突发高峰', threshold: 600, points: 30 },
  { id: 'sharedAccounts', label: '同 IP 关联账户，仅供共享网络复核', threshold: 5, points: 0 },
  { id: 'musicIpChanges', label: '近 10 分钟歌曲请求使用至少 3 个 IP 且频繁切换', threshold: 6, points: 20, highThreshold: 12, highPoints: 30 },
  { id: 'authFailures', label: '当日账户凭据多次验证失败，可能正在被攻击', threshold: 10, points: 15, highThreshold: 50, highPoints: 25 },
  { id: 'clientCount', label: '近 24 小时登录客户端特征较多，可被伪造需复核', threshold: 5, points: 10 },
  { id: 'roomHopping', label: '当日高频进入多个不同房间', threshold: 1, points: 15 },
  { id: 'highErrorRate', label: '当日错误较多且错误比例达到 30%', threshold: 1, points: 15 },
  { id: 'operationConcentration', label: '当日音乐操作至少 200 次且单一操作占比达到 90%', threshold: 90, points: 15 },
  { id: 'musicWithoutContext', label: '当日音乐请求至少 500 次、实时操作占比不超过 0.5% 且无成功入房', threshold: 1, points: 20 },
  { id: 'musicMinutePeak', label: '当日音乐请求分钟峰值达到 100', threshold: 100, points: 15 },
  { id: 'untrustedForwarded', label: '非可信代理来源携带转发头，已忽略，需检查代理配置', threshold: 20, points: 0 },
  { id: 'toolClientBurst', label: '工具类客户端声明伴随大量音乐请求且无成功入房', threshold: 1, points: 10 },
  { id: 'urlHarvesting', label: '成功取链至少 500 次且缺少房间及实时上下文，不含替代曲', threshold: 1, points: 10 },
  { id: 'emptyResponseRate', label: '已记录响应至少 100 次且空结果达到 80%，需先排除上游故障', threshold: 80, points: 0 },
  { id: 'musicOnlyBurst', label: '当日请求达到 1000 且音乐请求占比超过 90%', threshold: 1, points: 10 },
];

export function evaluateRisk(input = {}) {
  const operationCounts = MUSIC_OPERATIONS.map(key => Math.max(0, Number(input.operations?.[key]) || 0));
  const operationTotal = operationCounts.reduce((sum, value) => sum + value, 0);
  const concentration = operationTotal >= 200 && input.musicRequests >= 200 ? Math.floor(Math.max(...operationCounts) / operationTotal * 100) : 0;
  const signals = { ...input,
    toolClientBurst: !input.dailyEstimated && input.automationClientRequests >= 200 && input.musicRequests >= 200 && input.roomJoins === 0 ? 1 : 0,
    urlHarvesting: !input.dailyEstimated && input.responseUrlOk >= 500 && input.roomJoins === 0 && input.socketRequests >= 0 && input.socketRequests / input.responseUrlOk <= 0.005 ? 1 : 0,
    emptyResponseRate: input.responseTotal >= 100 ? Math.floor((input.responseEmpty || 0) / input.responseTotal * 100) : 0,
    operationConcentration: input.dailyEstimated ? 0 : concentration,
    musicWithoutContext: !input.dailyEstimated && input.musicRequests >= 500 && input.roomJoins === 0 && input.socketRequests >= 0 && input.socketRequests / input.musicRequests <= 0.005 ? 1 : 0,
    musicIpChanges: input.musicIpCount >= 3 ? input.musicIpChanges : 0,
    roomHopping: input.roomCount >= 10 && input.roomJoins >= 30 ? 1 : 0,
    highErrorRate: input.errors >= 20 && input.errors / Math.max(1, input.requests || 0) >= 0.3 ? 1 : 0,
    musicOnlyBurst: input.requests >= 1000 && input.musicRequests / input.requests > 0.9 ? 1 : 0,
  };
  const factors = RULES.map(rule => {
    const value = Math.max(0, Number(signals[rule.id]) || 0);
    const points = rule.highThreshold && value >= rule.highThreshold ? rule.highPoints : value >= rule.threshold ? rule.points : 0;
    const window = rule.id === 'musicIpChanges' ? '近 10 分钟' : ['ipCount', 'clientCount'].includes(rule.id) ? '近 24 小时' : rule.id === 'sharedAccounts' ? '近 90 天关联' : '北京时间今日';
  const category = ['ipCount', 'musicIpChanges', 'sharedAccounts', 'untrustedForwarded'].includes(rule.id) ? '网络与代理' : ['authFailures', 'clientCount', 'toolClientBurst'].includes(rule.id) ? '身份与客户端' : ['highErrorRate', 'emptyResponseRate', 'urlHarvesting'].includes(rule.id) ? '响应质量' : '请求行为';
    return { id: rule.id, label: rule.label, value, points, threshold: rule.threshold, maxPoints: rule.highPoints || rule.points, matched: value >= rule.threshold, window, category };
  });
  const score = Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0));
  return { score, level: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low', reasons: factors.filter(factor => factor.points).map(factor => factor.label), factors };
}

const SCORE_LUA = `
local function scoreRisk(profile, daily, ips, shared, clients, rooms, now, rules, musicIps, musicChanges)
  local fields = {'requests', 'music', 'denied', 'minutePeak', 'authFailures', 'roomJoins', 'errors', 'socketRequests', 'operation_url', 'operation_search', 'operation_lrc', 'operation_song', 'operation_playlist', 'operation_search_playlist', 'operation_fm', 'operation_source', 'operation_media', 'musicMinutePeak', 'untrustedForwarded', 'automationClientRequests', 'response_url_ok', 'response_total', 'response_empty'}
  local raw = redis.call('HMGET', daily, unpack(fields))
  local counts = {}
  for index, field in ipairs(fields) do counts[field] = tonumber(raw[index]) or 0 end
  local function count(field) return counts[field] or 0 end
  local operationTotal = 0
  local operationMax = 0
  for index = 9, 17 do
    local value = count(fields[index])
    operationTotal = operationTotal + value
    operationMax = math.max(operationMax, value)
  end
  local estimated = redis.call('GET', daily .. ':seeded') == 'utc-conservative'
  local ipCount = redis.call('ZCOUNT', ips, now - 86400000, '+inf')
  local unknown = redis.call('ZSCORE', ips, 'unknown')
  if unknown and tonumber(unknown) >= now - 86400000 then ipCount = ipCount - 1 end
  local requests = count('requests')
  local music = count('music')
  local values = {denied=count('denied'), ipCount=ipCount, minutePeak=count('minutePeak'), sharedAccounts=shared,
    musicIpChanges=redis.call('ZCOUNT', musicIps, now - 600000, '+inf') >= 3 and redis.call('ZCOUNT', musicChanges, now - 600000, '+inf') or 0,
    authFailures=count('authFailures'), clientCount=redis.call('ZCOUNT', clients, now - 86400000, '+inf'),
    roomHopping=redis.call('ZCARD', rooms) >= 10 and count('roomJoins') >= 30 and 1 or 0,
    highErrorRate=count('errors') >= 20 and count('errors') / math.max(1, requests) >= 0.3 and 1 or 0,
    operationConcentration=not estimated and music >= 200 and operationTotal >= 200 and math.floor(operationMax / operationTotal * 100) or 0,
    musicWithoutContext=not estimated and music >= 500 and count('roomJoins') == 0 and count('socketRequests') / music <= 0.005 and 1 or 0,
    musicMinutePeak=count('musicMinutePeak'), untrustedForwarded=count('untrustedForwarded'),
    toolClientBurst=not estimated and count('automationClientRequests') >= 200 and music >= 200 and count('roomJoins') == 0 and 1 or 0,
    urlHarvesting=not estimated and count('response_url_ok') >= 500 and count('roomJoins') == 0 and count('socketRequests') / count('response_url_ok') <= 0.005 and 1 or 0,
    emptyResponseRate=count('response_total') >= 100 and math.floor(count('response_empty') / count('response_total') * 100) or 0,
    musicOnlyBurst=requests >= 1000 and music / requests > 0.9 and 1 or 0}
  local score = 0
  for _, rule in ipairs(cjson.decode(rules)) do
    local value = values[rule.id] or 0
    if rule.highThreshold and value >= rule.highThreshold then score = score + rule.highPoints
    elseif value >= rule.threshold then score = score + rule.points end
  end
  return math.min(100, score)
end
local function trackClient(index, records, hash, agent, now)
  if hash == '' then return end
  redis.call('ZADD', index, now, hash)
  redis.call('HSET', records, hash, agent)
  local old = redis.call('ZRANGEBYSCORE', index, '-inf', now - 7776000000)
  for _, value in ipairs(old) do redis.call('ZREM', index, value); redis.call('HDEL', records, value) end
  local overflow = redis.call('ZRANGE', index, 0, -51)
  for _, value in ipairs(overflow) do redis.call('ZREM', index, value); redis.call('HDEL', records, value) end
  redis.call('EXPIRE', index, 7776000)
  redis.call('EXPIRE', records, 7776000)
end
`;

function clientSignal(agent) {
  const value = String(agent || '').replace(/[\r\n\x00-\x1f]/gu, '').slice(0, 320);
  return value ? [createHash('sha256').update(value).digest('hex'), value] : ['', ''];
}

function safeIdentity(account, fallback = {}) {
  const email = String(account ? account.email || '' : fallback.email || '');
  const identities = (Array.isArray(account?.identities) ? account.identities : []).filter(entry => ['email', 'github', 'linuxdo', 'wechat'].includes(entry.provider)).map(entry => ({
    provider: entry.provider, username: String(entry.username || '').slice(0, 128), linkedAt: Number(entry.linkedAt || 0),
    subjectHint: entry.provider === 'email' ? '' : entry.subject ? (String(entry.subject).length > 6 ? `${String(entry.subject).slice(0, 2)}***${String(entry.subject).slice(-2)}` : '***') : '',
  }));
  return { displayName: identities.find(entry => entry.username)?.username || fallback.nickname || email.split('@')[0] || '',
    email, emailVerified: Boolean(account?.emailVerifiedAt), hasPassword: Boolean(account?.password),
    identities, identityCount: identities.length, identityAvailable: Boolean(account), roomUserId: String(account?.roomUserId || '') };
}

const CONSUME_SCRIPT = `${SCORE_LUA}
${HUMAN_GATE_LUA}
local now = tonumber(ARGV[1])
local id = ARGV[2]
local ip = ARGV[3]
local kind = ARGV[4]
redis.call('HSETNX', KEYS[1], 'firstSeenAt', ARGV[1])
redis.call('HSETNX', KEYS[1], 'status', 'normal')
redis.call('HSET', KEYS[1], 'lastSeenAt', ARGV[1], 'lastRequestIp', ip, 'lastNetworkIp', ip, 'email', ARGV[5], 'createdAt', ARGV[6])
redis.call('HDEL', KEYS[1], 'scoreResetAt')
redis.call('ZADD', KEYS[2], now, id)
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'normal' and status ~= 'watch' and status ~= 'blocked' then return redis.error_reply('Invalid risk status') end
redis.call('ZADD', KEYS[10] .. status, now, id)
redis.call('HINCRBY', KEYS[1], 'requests', 1)
redis.call('HINCRBY', KEYS[1], kind .. 'Requests', 1)
local minute = kind == 'image' and tonumber(redis.call('HGET', KEYS[3], 'requests') or '0') or redis.call('HINCRBY', KEYS[3], 'requests', 1)
local daily = redis.call('HINCRBY', KEYS[4], 'requests', 1)
local ipMinute = kind == 'image' and tonumber(redis.call('GET', KEYS[5]) or '0') or redis.call('INCR', KEYS[5])
redis.call('EXPIRE', KEYS[3], 120)
redis.call('EXPIRE', KEYS[4], 3024000)
redis.call('EXPIRE', KEYS[5], 120)
local musicMinute = tonumber(redis.call('HGET', KEYS[3], 'music') or '0')
local musicDay = tonumber(redis.call('HGET', KEYS[4], 'music') or '0')
if kind == 'music' or ARGV[13] == '1' then
  musicMinute = redis.call('HINCRBY', KEYS[3], 'music', 1)
  musicDay = redis.call('HINCRBY', KEYS[4], 'music', 1)
  if kind ~= 'music' then
    redis.call('HINCRBY', KEYS[1], 'musicRequests', 1)
    redis.call('HINCRBY', KEYS[4], 'musicRequests', 1)
  end
end
redis.call('HINCRBY', KEYS[4], kind .. 'Requests', 1)
redis.call('HINCRBY', KEYS[4], 'operation_' .. ARGV[12], 1)
local peak = tonumber(redis.call('HGET', KEYS[4], 'minutePeak') or '0')
if minute > peak then redis.call('HSET', KEYS[4], 'minutePeak', minute) end
if musicMinute > tonumber(redis.call('HGET', KEYS[4], 'musicMinutePeak') or '0') then redis.call('HSET', KEYS[4], 'musicMinutePeak', musicMinute) end
if ARGV[18] ~= '' then redis.call('HSET', KEYS[1], 'lastNetworkRoute', ARGV[18]) end
if ARGV[19] == '1' then redis.call('HINCRBY', KEYS[4], 'untrustedForwarded', 1) end
if ARGV[20] == '1' then redis.call('HINCRBY', KEYS[4], 'automationClientRequests', 1) end
local code = ''
-- 账户级取链预算，不按会话或 IP 拆分，使用既有 Hash，不为歌曲或请求新增键
local urlLimited = false
if kind == 'music' and (ARGV[12] == 'url' or ARGV[12] == 'source' or ARGV[12] == 'song') then
  local capacity = tonumber(ARGV[26])
  local previous = tonumber(redis.call('HGET', KEYS[1], 'urlBudgetAt') or now)
  local tokens = math.min(capacity, tonumber(redis.call('HGET', KEYS[1], 'urlBudgetTokens') or capacity)
    + math.max(0, now - previous) * capacity / 10000)
  local urlMinute = redis.call('HINCRBY', KEYS[3], 'urlRequests', 1)
  urlLimited = tokens < 1 or urlMinute > tonumber(ARGV[25])
  if not urlLimited then tokens = tokens - 1 end
  redis.call('HSET', KEYS[1], 'urlBudgetAt', math.max(now, previous), 'urlBudgetTokens', tokens)
end
local limitedDaily = daily - tonumber(redis.call('HGET', KEYS[4], 'imageRequests') or '0')
local limited = kind ~= 'image' and (minute > tonumber(ARGV[7]) or limitedDaily > tonumber(ARGV[8]) or ipMinute > tonumber(ARGV[11])
  or musicMinute > tonumber(ARGV[9]) or musicDay > tonumber(ARGV[10]) or urlLimited)
if status == 'blocked' and kind ~= 'image' then code = 'ACCOUNT_RISK_BLOCKED'
elseif limited then code = 'ACCOUNT_RATE_LIMITED' end
if code ~= '' then
  redis.call('HINCRBY', KEYS[1], 'denied', 1)
  redis.call('HINCRBY', KEYS[4], 'denied', 1)
  redis.call('HSET', KEYS[1], 'lastDeniedAt', now, 'lastDeniedCode', code)
end
if kind ~= 'image' then redis.call('ZADD', KEYS[6], now, ip) end
redis.call('ZREMRANGEBYSCORE', KEYS[6], '-inf', now - 86400000)
redis.call('ZREMRANGEBYRANK', KEYS[6], 0, -501)
redis.call('EXPIRE', KEYS[6], 172800)
redis.call('ZADD', KEYS[7], now, id)
redis.call('ZREMRANGEBYSCORE', KEYS[7], '-inf', now - 7776000000)
redis.call('ZREMRANGEBYRANK', KEYS[7], 0, -2001)
redis.call('EXPIRE', KEYS[7], 7776000)
local shared = redis.call('ZCARD', KEYS[7])
if kind ~= 'image' then trackClient(KEYS[13], KEYS[14], ARGV[15], ARGV[16], now) end
if ip == 'unknown' then shared = 0 end
local sequence = redis.call('HGET', KEYS[1], 'requests')
local isMusic = kind == 'music' or ARGV[13] == '1'
if isMusic and ip ~= 'unknown' then
  local previous = redis.call('HMGET', KEYS[1], 'lastMusicIp', 'lastMusicAt')
  if previous[1] and previous[1] ~= ip and tonumber(previous[2] or '0') >= now - 600000 then
    redis.call('ZADD', KEYS[16], now, ARGV[1] .. ':' .. sequence)
  end
  redis.call('HSET', KEYS[1], 'lastMusicIp', ip, 'lastMusicAt', now)
  redis.call('ZADD', KEYS[15], now, ip)
end
for _, key in ipairs({KEYS[15], KEYS[16]}) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - 600000)
  redis.call('ZREMRANGEBYRANK', key, 0, -501)
  redis.call('EXPIRE', key, 1200)
end
if ip ~= 'unknown' then
  redis.call('ZADD', KEYS[20], now, ip)
  redis.call('ZREMRANGEBYSCORE', KEYS[20], '-inf', now - 7776000000)
  redis.call('ZREMRANGEBYRANK', KEYS[20], 0, -201)
  redis.call('EXPIRE', KEYS[20], 7776000)
end
local rawGroup = redis.call('HGET', KEYS[18], ip)
local group = rawGroup and cjson.decode(rawGroup) or {ip=ip, total=0, music=0, socket=0, image=0, api=0, firstSeenAt=now}
group.total = group.total + 1
group[kind] = (group[kind] or 0) + 1
if isMusic and kind ~= 'music' then group.music = group.music + 1 end
group.lastSeenAt = now
redis.call('HSET', KEYS[18], ip, cjson.encode(group))
redis.call('ZADD', KEYS[17], now, ip)
local stale = redis.call('ZRANGEBYSCORE', KEYS[17], '-inf', now - 7776000000)
for _, address in ipairs(stale) do redis.call('ZREM', KEYS[17], address); redis.call('HDEL', KEYS[18], address) end
local overflow = redis.call('ZRANGE', KEYS[17], 0, -201)
for _, address in ipairs(overflow) do redis.call('ZREM', KEYS[17], address); redis.call('HDEL', KEYS[18], address) end
redis.call('EXPIRE', KEYS[17], 7776000)
redis.call('EXPIRE', KEYS[18], 7776000)
if isMusic or kind == 'socket' then
  redis.call('LPUSH', KEYS[19], cjson.encode({id=ARGV[17], at=now, ip=ip, kind=kind, operation=ARGV[12]}))
  redis.call('LTRIM', KEYS[19], 0, 199)
  redis.call('EXPIRE', KEYS[19], 86400)
end
local score = scoreRisk(KEYS[1], KEYS[4], KEYS[6], shared, KEYS[13], KEYS[12], now, ARGV[14], KEYS[15], KEYS[16])
if ARGV[21] == '1' and ARGV[12] ~= 'refresh' and humanGate(KEYS[1], now, ARGV[22], ARGV[23], code == '' and score >= 60 and kind ~= 'image', ARGV[24], id) == 1 then
  if code == '' then
    redis.call('HINCRBY', KEYS[1], 'denied', 1)
    redis.call('HINCRBY', KEYS[4], 'denied', 1)
  end
  code = 'ACCOUNT_HUMAN_CHECK_REQUIRED'
  redis.call('HSET', KEYS[1], 'lastDeniedAt', now, 'lastDeniedCode', code)
end
redis.call('HSET', KEYS[1], 'score', score, 'scoreAt', now)
redis.call('ZADD', KEYS[8], score, id)
if status == 'blocked' then
  redis.call('ZREM', KEYS[21], id); redis.call('ZREM', KEYS[22], id)
  redis.call('ZADD', KEYS[23], score, id); redis.call('ZADD', KEYS[24], now, id)
else
  redis.call('ZADD', KEYS[21], score, id); redis.call('ZADD', KEYS[22], now, id)
  redis.call('ZREM', KEYS[23], id); redis.call('ZREM', KEYS[24], id)
end
if code ~= '' and redis.call('SET', KEYS[9], '1', 'EX', 60, 'NX') then
  while redis.call('LLEN', KEYS[11]) > 0 do
    local oldest = cjson.decode(redis.call('LINDEX', KEYS[11], -1))
    if tonumber(oldest.at) >= now - 7776000000 then break end
    redis.call('RPOP', KEYS[11])
  end
  redis.call('LPUSH', KEYS[11], cjson.encode({at=now, accountId=id, ip=ip, kind=kind, code=code}))
  redis.call('LTRIM', KEYS[11], 0, 1999)
  redis.call('EXPIRE', KEYS[11], 7776000)
end
return {code, minute, limitedDaily, musicDay, score, limited and 1 or 0}
`;

const LOGIN_SCRIPT = `${SCORE_LUA}
redis.call('HSETNX', KEYS[1], 'firstSeenAt', ARGV[1])
redis.call('HSETNX', KEYS[1], 'status', 'normal')
redis.call('HSET', KEYS[1], 'lastSeenAt', ARGV[1], 'lastLoginAt', ARGV[1], 'lastLoginIp', ARGV[3], 'lastNetworkIp', ARGV[3], 'email', ARGV[4], 'createdAt', ARGV[5])
redis.call('HDEL', KEYS[1], 'scoreResetAt')
if ARGV[6] == '1' then redis.call('HSETNX', KEYS[1], 'registrationIp', ARGV[3]) end
redis.call('HINCRBY', KEYS[1], 'loginCount', 1)
if ARGV[10] == '1' then redis.call('HSET', KEYS[1], 'lastHumanVerifiedAt', ARGV[1]) end
redis.call('ZADD', KEYS[2], ARGV[1], ARGV[2])
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'normal' and status ~= 'watch' and status ~= 'blocked' then return redis.error_reply('Invalid risk status') end
redis.call('ZADD', KEYS[8] .. status, ARGV[1], ARGV[2])
local score = tonumber(redis.call('HGET', KEYS[1], 'score') or '0')
if status == 'blocked' then
  redis.call('ZREM', KEYS[11], ARGV[2]); redis.call('ZREM', KEYS[12], ARGV[2]); redis.call('ZADD', KEYS[13], score, ARGV[2]); redis.call('ZADD', KEYS[14], ARGV[1], ARGV[2])
else
  redis.call('ZADD', KEYS[11], score, ARGV[2]); redis.call('ZADD', KEYS[12], ARGV[1], ARGV[2]); redis.call('ZREM', KEYS[13], ARGV[2]); redis.call('ZREM', KEYS[14], ARGV[2])
end
redis.call('ZADD', KEYS[3], ARGV[1], ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', tonumber(ARGV[1]) - 7776000000)
redis.call('ZREMRANGEBYRANK', KEYS[3], 0, -101)
redis.call('EXPIRE', KEYS[3], 7776000)
redis.call('ZADD', KEYS[4], ARGV[1], ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', tonumber(ARGV[1]) - 86400000)
redis.call('ZREMRANGEBYRANK', KEYS[4], 0, -501)
redis.call('EXPIRE', KEYS[4], 172800)
redis.call('ZADD', KEYS[5], ARGV[1], ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', tonumber(ARGV[1]) - 7776000000)
redis.call('ZREMRANGEBYRANK', KEYS[5], 0, -2001)
redis.call('EXPIRE', KEYS[5], 7776000)
redis.call('LPUSH', KEYS[6], ARGV[7])
redis.call('LTRIM', KEYS[6], 0, 99)
while redis.call('LLEN', KEYS[6]) > 0 do
  local oldest = cjson.decode(redis.call('LINDEX', KEYS[6], -1))
  if tonumber(oldest.at) >= tonumber(ARGV[1]) - 7776000000 then break end
  redis.call('RPOP', KEYS[6])
end
redis.call('EXPIRE', KEYS[6], 7776000)
redis.call('ZADD', KEYS[7], 'NX', 0, ARGV[2])
trackClient(KEYS[9], KEYS[10], ARGV[8], ARGV[9], tonumber(ARGV[1]))
return 1
`;

const MUSIC_RESPONSE_SCRIPT = `
      if redis.call('HEXISTS', KEYS[1], 'firstSeenAt') == 0 then return 0 end
      if redis.call('HEXISTS', KEYS[3], ARGV[1]) == 1 then return 0 end
      redis.call('HSET', KEYS[3], ARGV[1], ARGV[2])
      redis.call('LPUSH', KEYS[2], ARGV[1])
      if redis.call('LLEN', KEYS[2]) > 200 then
        local old = redis.call('RPOP', KEYS[2])
        redis.call('HDEL', KEYS[3], old)
      end
      redis.call('EXPIRE', KEYS[2], 86400)
      redis.call('EXPIRE', KEYS[3], 86400)
      redis.call('HINCRBY', KEYS[4], 'response_' .. ARGV[3], 1)
      redis.call('HINCRBY', KEYS[4], 'response_total', 1)
      if ARGV[5] == 'url' and ARGV[3] == 'ok' then redis.call('HINCRBY', KEYS[4], 'response_url_ok', 1) end
      redis.call('HINCRBY', KEYS[4], 'response_duration_ms', ARGV[4])
      redis.call('EXPIRE', KEYS[4], 3024000)
      return 1
    `;

export function createRiskControl({ getStore = getRedisClient, prefix = 'openmusic:risk:v1:', now = () => Date.now() } = {}) {
  function store() {
    const client = getStore();
    if (!client) throw new RiskControlError('RISK_STORAGE_UNAVAILABLE', '风控存储暂不可用，请稍后重试');
    return client;
  }
  async function run(operation) {
    try { return await operation(store()); }
    catch (error) {
      if (error instanceof RiskControlError) throw error;
      throw new RiskControlError('RISK_STORAGE_UNAVAILABLE', '风控存储暂不可用，请稍后重试');
    }
  }
  const profileKey = (id) => `${prefix}account:${accountId(id)}`;
  const ipKey = (ip) => `${prefix}ip:${createHash('sha256').update(cleanIp(ip)).digest('hex')}`;
  const dateKey = riskDate;
  const dailyKey = (id, timestamp) => `${prefix}day-cn:${id}:${dateKey(timestamp)}`;
  const roomDayKey = (id, timestamp) => `${prefix}room-day:${id}:${dateKey(timestamp)}`;

  async function ensureDaily(id, timestamp) {
    const start = Math.floor((timestamp + CHINA_OFFSET) / DAY) * DAY - CHINA_OFFSET;
    const legacy = [start, start + DAY - 1].map(value => `${prefix}day:${id}:${new Date(value).toISOString().slice(0, 10)}`);
    await run(client => evalRedisScript(client, `
      local cutover = redis.call('GET', KEYS[4])
      if not cutover then cutover = ARGV[1]; redis.call('SET', KEYS[4], cutover) end
      if redis.call('EXISTS', KEYS[5]) == 1 then return 1 end
      local imported = false
      if cutover == ARGV[1] then
        for index = 2, 3 do
          local fields = redis.call('HGETALL', KEYS[index])
          for field = 1, #fields, 2 do
            local count = tonumber(fields[field + 1])
            if count and count >= 0 and count == math.floor(count) then
              imported = true
              if fields[field] == 'minutePeak' then
                local current = tonumber(redis.call('HGET', KEYS[1], fields[field]) or '0')
                redis.call('HSET', KEYS[1], fields[field], math.max(current, count))
              else redis.call('HINCRBY', KEYS[1], fields[field], count) end
            end
          end
        end
      end
      redis.call('SET', KEYS[5], imported and 'utc-conservative' or 'native', 'EX', 3024000)
      redis.call('EXPIRE', KEYS[1], 3024000)
      return 1
    `, { keys: [dailyKey(id, timestamp), ...legacy, `${prefix}china-day-cutover`, `${dailyKey(id, timestamp)}:seeded`], arguments: [dateKey(timestamp)] }));
  }

  async function refreshScore(id) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const timestamp = now();
      const addresses = await run(client => client.hmGet(profileKey(id), ['lastNetworkIp', 'lastRequestIp', 'lastLoginIp']));
      const expected = addresses.find(Boolean) || '';
      const address = cleanIp(expected);
      const result = await run(client => evalRedisScript(client, `${SCORE_LUA}
        if redis.call('HEXISTS', KEYS[1], 'firstSeenAt') == 0 then return 0 end
        local current = redis.call('HGET', KEYS[1], 'lastNetworkIp') or redis.call('HGET', KEYS[1], 'lastRequestIp') or redis.call('HGET', KEYS[1], 'lastLoginIp') or ''
        if current ~= ARGV[5] then return -1 end
        if tonumber(redis.call('HGET', KEYS[1], 'scoreAt') or '0') > tonumber(ARGV[1]) then return tonumber(redis.call('HGET', KEYS[1], 'score') or '0') end
        local shared = ARGV[4] == 'unknown' and 0 or redis.call('ZCOUNT', KEYS[4], tonumber(ARGV[1]) - 7776000000, '+inf')
        local score = scoreRisk(KEYS[1], KEYS[2], KEYS[3], shared, KEYS[5], KEYS[6], tonumber(ARGV[1]), ARGV[2], KEYS[8], KEYS[9])
        redis.call('HSET', KEYS[1], 'score', score, 'scoreAt', ARGV[1])
        redis.call('ZADD', KEYS[7], score, ARGV[3])
        local seen = tonumber(redis.call('HGET', KEYS[1], 'lastSeenAt') or ARGV[1])
        if redis.call('HGET', KEYS[1], 'status') == 'blocked' then
          redis.call('ZREM', KEYS[10], ARGV[3]); redis.call('ZREM', KEYS[11], ARGV[3]); redis.call('ZADD', KEYS[12], score, ARGV[3]); redis.call('ZADD', KEYS[13], seen, ARGV[3])
        else
          redis.call('ZADD', KEYS[10], score, ARGV[3]); redis.call('ZADD', KEYS[11], seen, ARGV[3]); redis.call('ZREM', KEYS[12], ARGV[3]); redis.call('ZREM', KEYS[13], ARGV[3])
        end
        return score
      `, { keys: [profileKey(id), dailyKey(id, timestamp), `${prefix}recent-ips:${id}`, ipKey(address), `${prefix}clients:${id}`, roomDayKey(id, timestamp), `${prefix}scores`, `${prefix}music-ips:${id}`, `${prefix}music-ip-changes:${id}`, `${prefix}main-scores`, `${prefix}main-recent`, `${prefix}blocked-scores`, `${prefix}blocked-recent`], arguments: [String(timestamp), JSON.stringify(RULES), id, address, expected] }));
      if (result !== -1) {
        if (!Number.isSafeInteger(result) || result < 0 || result > 100) throw new RiskControlError('RISK_STORAGE_UNAVAILABLE', '风险评分暂不可用，请稍后重试');
        return result;
      }
    }
    throw new RiskControlError('RISK_SCORE_CONFLICT', '账户活动变化较快，请稍后重试');
  }

  async function getPolicy() {
    return run(async (client) => {
      const raw = await client.get(`${prefix}policy`);
      return raw ? validateRiskPolicy(JSON.parse(raw)) : { ...DEFAULT_POLICY };
    });
  }

  async function setPolicy(input) {
    validateRiskPolicy(input);
    const policy = validateRiskPolicy({ ...await getPolicy(), ...input });
    await run((client) => client.set(`${prefix}policy`, JSON.stringify(policy)));
    return policy;
  }

  async function sessionStatus(id) {
    const status = await run((client) => client.hGet(profileKey(id), 'status'));
    if (status !== null && !STATUSES.has(status)) throw new RiskControlError('RISK_STORAGE_UNAVAILABLE', '风控存储暂不可用，请稍后重试');
    return status || 'normal';
  }

  async function assertAllowed(id, { human = false } = {}) {
    const [status, pending, bypass] = human
      ? await run(client => client.hmGet(profileKey(id), ['status', 'humanPending', 'humanBypass']))
      : [await sessionStatus(id)];
    if (status !== null && status !== undefined && !STATUSES.has(status)) throw new RiskControlError('RISK_STORAGE_UNAVAILABLE', '风控存储暂不可用，请稍后重试');
    if (status === 'blocked') throw new RiskControlError('ACCOUNT_RISK_BLOCKED', '账户访问已受限，请联系管理员复核', 403);
    const config = getRuntimeConfig();
    if (human && config.riskChallengeEnabled && config.turnstileEnabled && pending && bypass !== '1') {
      throw new RiskControlError('ACCOUNT_HUMAN_CHECK_REQUIRED', '访问行为异常，请先完成人机验证', 403);
    }
  }

  async function recordLogin(account, { ip, method = 'session', registration = false, userAgent = '', humanVerifiedAt = 0 } = {}) {
    const id = accountId(account?.id);
    const timestamp = now();
    const address = cleanIp(ip);
    await ensureDaily(id, timestamp);
    const result = await run((client) => evalRedisScript(client, LOGIN_SCRIPT, {
      keys: [profileKey(id), `${prefix}accounts`, `${prefix}ips:${id}`, `${prefix}recent-ips:${id}`, ipKey(address), `${prefix}logins:${id}`, `${prefix}scores`, `${prefix}status:`, `${prefix}clients:${id}`, `${prefix}client-info:${id}`, `${prefix}main-scores`, `${prefix}main-recent`, `${prefix}blocked-scores`, `${prefix}blocked-recent`],
      arguments: [String(timestamp), id, address, String(account.email || ''), String(account.createdAt || 0), registration ? '1' : '0', JSON.stringify({ at: timestamp, ip: address, method, userAgent: clientSignal(userAgent)[1] }), ...clientSignal(userAgent), Number.isSafeInteger(humanVerifiedAt) && humanVerifiedAt > 0 && humanVerifiedAt <= timestamp && humanVerifiedAt >= timestamp - 300000 ? '1' : '0'],
    }));
    if (!result) throw new RiskControlError('RISK_STORAGE_UNAVAILABLE', '登录记录暂不可用，请稍后重试');
    await refreshScore(id);
  }

  async function consume(account, { ip, kind = 'api', operation = '', music = false, userAgent = '', network = {} } = {}) {
    const id = accountId(account?.id);
    const timestamp = now();
    const address = cleanIp(ip);
    const requestId = randomBytes(16).toString('hex');
    const category = ['api', 'music', 'socket', 'image'].includes(kind) ? kind : 'api';
    const action = ['url', 'search', 'pic', 'lrc', 'song', 'playlist', 'search_playlist', 'fm', 'source', 'media', 'qr', 'queue', 'refresh'].includes(operation) ? operation : category;
    const [policy] = await Promise.all([getPolicy(), ensureDaily(id, timestamp)]);
    const options = {
      keys: [profileKey(id), `${prefix}accounts`, `${prefix}minute:${id}:${Math.floor(timestamp / 60_000)}`, dailyKey(id, timestamp), `${ipKey(address)}:minute:${Math.floor(timestamp / 60_000)}`, `${prefix}recent-ips:${id}`, ipKey(address), `${prefix}scores`, `${prefix}alert:${id}`, `${prefix}status:`, `${prefix}events`, roomDayKey(id, timestamp), `${prefix}clients:${id}`, `${prefix}client-info:${id}`, `${prefix}music-ips:${id}`, `${prefix}music-ip-changes:${id}`, `${prefix}request-ips:${id}`, `${prefix}request-ip-counts:${id}`, `${prefix}request-events:${id}`, `${prefix}ips:${id}`, `${prefix}main-scores`, `${prefix}main-recent`, `${prefix}blocked-scores`, `${prefix}blocked-recent`],
      arguments: [String(timestamp), id, address, category, String(account.email || ''), String(account.createdAt || 0), ...[policy.minuteLimit, policy.dayLimit, policy.musicMinuteLimit, policy.musicDayLimit, policy.ipMinuteLimit].map(String), action, music ? '1' : '0', JSON.stringify(RULES), ...clientSignal(userAgent), requestId, ['direct', 'trusted_proxy'].includes(network.route) ? network.route : '', network.untrustedForwarded === true ? '1' : '0', /curl|wget|python-requests|httpx|headless|selenium|playwright|okhttp|dart\//iu.test(String(userAgent).slice(0, 320)) ? '1' : '0', getRuntimeConfig().riskChallengeEnabled ? '1' : '0', dateKey(timestamp), randomBytes(24).toString('hex')],
    };
    const result = await run(client => evalRedisScript(client, CONSUME_SCRIPT, {
      ...options, arguments: [...options.arguments, riskChallengeChannel(client, prefix), String(policy.urlMinuteLimit), String(policy.urlBurstLimit)],
    }));
    if (!Array.isArray(result) || result.length !== 6 || !['', 'ACCOUNT_RISK_BLOCKED', 'ACCOUNT_RATE_LIMITED', 'ACCOUNT_HUMAN_CHECK_REQUIRED'].includes(result[0])
      || result.slice(1).some((value) => !Number.isSafeInteger(value) || value < 0)
      || result[4] > 100 || ![0, 1].includes(result[5]) || (result[0] === '' && result[5] !== 0)
      || (result[0] === 'ACCOUNT_RATE_LIMITED' && result[5] !== 1)) {
      throw new RiskControlError('RISK_STORAGE_UNAVAILABLE', '风控存储暂不可用，请稍后重试');
    }
    const code = String(result[0]);
    const dailyExhausted = Number(result[2]) > policy.dayLimit || Number(result[3]) > policy.musicDayLimit;
    const retryAfter = dailyExhausted ? riskDayRemaining(timestamp) : 60 - Math.floor(timestamp / 1000) % 60;
    return { allowed: !code, code, requestId, at: timestamp, status: ['ACCOUNT_RISK_BLOCKED', 'ACCOUNT_HUMAN_CHECK_REQUIRED'].includes(code) ? 403 : 429, limited: code !== 'ACCOUNT_HUMAN_CHECK_REQUIRED' && Number(result[5]) === 1, retryAfter, minute: Number(result[1]), daily: Number(result[2]), musicDaily: Number(result[3]), score: Number(result[4]) };
  }

  async function humanChallengeStatus(id) {
    const profile = await run(client => client.hGetAll(profileKey(id)));
    return humanChallengeSnapshot(profile, dateKey(now()));
  }

  async function completeHumanChallenge(id, challengeId) {
    if (typeof challengeId !== 'string' || !/^[a-f0-9]{48}$/u.test(challengeId)) throw new RiskControlError('HUMAN_CHECK_FAILED', '验证轮次无效，请重新加载', 403);
    const timestamp = now();
    const result = await run(client => evalRedisScript(client, HUMAN_COMPLETE_SCRIPT, {
      keys: [profileKey(id)], arguments: [String(timestamp), dateKey(timestamp), challengeId, String(getRuntimeConfig().riskChallengeCooldownMinutes * 60000)],
    }));
    if (Number(result) !== 1) throw new RiskControlError('HUMAN_CHECK_FAILED', '验证轮次已变化或账户已受限，请重新加载', 403);
    return humanChallengeStatus(id);
  }

  async function setHumanChallengeBypass(id, input) {
    if (typeof input?.bypass !== 'boolean' || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 200) throw new RiskControlError('RISK_DECISION_INVALID', '请填写放行状态及 200 字内的原因', 400);
    const result = await run(client => evalRedisScript(client, `
      if redis.call('HEXISTS', KEYS[1], 'firstSeenAt') == 0 then return 0 end
      local previous = redis.call('HGET', KEYS[1], 'humanBypass')
      redis.call('HSET', KEYS[1], 'humanBypass', ARGV[1], 'humanBypassReason', ARGV[2])
      if previous == '1' and ARGV[1] == '0' and redis.call('HEXISTS', KEYS[1], 'humanPending') == 1 then
        redis.call('PUBLISH', ARGV[3], ARGV[4])
      end
      return 1
    `, { keys: [profileKey(id)], arguments: [input.bypass ? '1' : '0', input.reason.trim(), riskChallengeChannel(client, prefix), accountId(id)] }));
    if (Number(result) !== 1) throw new RiskControlError('RISK_ACCOUNT_NOT_FOUND', '尚无账户风控记录', 404);
    return humanChallengeStatus(id);
  }

  async function recordMusicResponse(id, input) {
    accountId(id);
    const event = normalizeMusicResponseEvent(input);
    const timestamp = now();
    if (!event || event.at < timestamp - DAY || event.at > timestamp) throw new RiskControlError('RISK_RESPONSE_INVALID', '歌曲响应摘要无效', 400);
    event.ip = cleanIp(input.ip);
    // 每个响应只执行一次固定规模脚本，去重和淘汰在同一原子操作完成
    await run(client => evalRedisScript(client, MUSIC_RESPONSE_SCRIPT, { keys: [profileKey(id), `${prefix}music-response-order:${id}`, `${prefix}music-responses:${id}`, dailyKey(id, event.at)],
      arguments: [event.requestId, JSON.stringify(event), event.outcome, String(event.durationMs), event.operation] }));
  }

  async function recordOutcome(id, status, requestAt = now(), context = {}) {
    const error = normalizeRiskError(status, context);
    if (!error) return;
    if (!Number.isSafeInteger(requestAt) || requestAt < 0 || requestAt > now()) throw new RiskControlError('RISK_TIME_INVALID', '请求时间无效', 400);
    const timestamp = requestAt;
    const groupId = createHash('sha256').update(JSON.stringify(error)).digest('hex').slice(0, 24);
    const event = { ...error, at: timestamp, groupId };
    await ensureDaily(accountId(id), timestamp);
    const recorded = await run(client => evalRedisScript(client, `
      if redis.call('HEXISTS', KEYS[1], 'firstSeenAt') == 0 then return 0 end
      redis.call('HINCRBY', KEYS[1], 'errors', 1)
      redis.call('HINCRBY', KEYS[2], 'errors', 1)
      redis.call('EXPIRE', KEYS[2], 3024000)
      local event = cjson.decode(ARGV[1])
      local groupId = event.groupId
      if redis.call('HEXISTS', KEYS[3], groupId) == 0 and redis.call('HLEN', KEYS[3]) >= 100 then groupId = 'overflow' end
      local raw = redis.call('HGET', KEYS[3], groupId)
      local group = raw and cjson.decode(raw) or cjson.decode(ARGV[1])
      if groupId == 'overflow' and not raw then
        group = {code='OTHER_ERRORS', category='other', label='其他错误（分类已达上限）', status=0, operation='api', method='OTHER', source=''}
      end
      group.groupId = groupId
      group.count = (group.count or 0) + 1
      group.firstSeenAt = math.min(group.firstSeenAt or event.at, event.at)
      group.lastSeenAt = math.max(group.lastSeenAt or event.at, event.at)
      redis.call('HSET', KEYS[3], groupId, cjson.encode(group))
      redis.call('HINCRBY', KEYS[2], 'error_group_' .. groupId, 1)
      redis.call('HINCRBY', KEYS[4], 'trackedTotal', 1)
      local since = tonumber(redis.call('HGET', KEYS[4], 'sinceAt') or event.at)
      redis.call('HSET', KEYS[4], 'sinceAt', math.min(since, event.at))
      redis.call('LPUSH', KEYS[5], ARGV[1])
      redis.call('LTRIM', KEYS[5], 0, 99)
      redis.call('EXPIRE', KEYS[5], 7776000)
      redis.call('EXPIRE', KEYS[3], 7776000)
      redis.call('EXPIRE', KEYS[4], 7776000)
      return 1
    `, { keys: [profileKey(id), dailyKey(id, timestamp), `${prefix}error-groups:${id}`, `${prefix}error-meta:${id}`, `${prefix}error-events:${id}`], arguments: [JSON.stringify(event)] }));
    if (recorded !== 1) return;
    await refreshScore(id);
  }

  async function recordRoomVisit(id, { roomId, roomName = '', nickname = '', ip, readOnly = false } = {}) {
    accountId(id);
    const normalized = String(roomId || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,64}$/u.test(normalized)) throw new RiskControlError('RISK_ROOM_INVALID', '房间标识无效', 400);
    const timestamp = now();
    await ensureDaily(id, timestamp);
    const recorded = await run(client => evalRedisScript(client, `
      if redis.call('HEXISTS', KEYS[1], 'firstSeenAt') == 0 then return 0 end
      local previous = redis.call('HGET', KEYS[3], ARGV[1])
      local room = previous and cjson.decode(previous) or {firstSeenAt=tonumber(ARGV[2]), joins=0, lastCountedAt=0}
      if tonumber(ARGV[2]) - tonumber(room.lastCountedAt or 0) >= 60000 then
        room.joins = room.joins + 1; room.lastCountedAt = tonumber(ARGV[2])
        redis.call('HINCRBY', KEYS[1], 'roomJoins', 1)
        redis.call('HINCRBY', KEYS[5], 'roomJoins', 1)
      end
      room.roomId = ARGV[1]; room.roomName = ARGV[3]; room.nickname = ARGV[4]
      room.lastSeenAt = tonumber(ARGV[2]); room.ip = ARGV[5]; room.readOnly = ARGV[6] == '1'
      redis.call('HSET', KEYS[3], ARGV[1], cjson.encode(room))
      redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
      local old = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', tonumber(ARGV[2]) - 7776000000)
      for _, value in ipairs(old) do redis.call('ZREM', KEYS[2], value); redis.call('HDEL', KEYS[3], value) end
      local overflow = redis.call('ZRANGE', KEYS[2], 0, -201)
      for _, value in ipairs(overflow) do redis.call('ZREM', KEYS[2], value); redis.call('HDEL', KEYS[3], value) end
      redis.call('EXPIRE', KEYS[2], 7776000); redis.call('EXPIRE', KEYS[3], 7776000)
      redis.call('ZADD', KEYS[4], ARGV[2], ARGV[1]); redis.call('EXPIRE', KEYS[4], 172800)
      redis.call('EXPIRE', KEYS[5], 3024000)
      redis.call('HSET', KEYS[1], 'nickname', ARGV[4], 'lastRoomId', ARGV[1], 'lastRoomAt', ARGV[2])
      return 1
    `, { keys: [profileKey(id), `${prefix}rooms:${id}`, `${prefix}room-info:${id}`, roomDayKey(id, timestamp), dailyKey(id, timestamp)], arguments: [normalized, String(timestamp), String(roomName).slice(0, 80), String(nickname).slice(0, 64), cleanIp(ip), readOnly ? '1' : '0'] }));
    if (recorded === 1) await refreshScore(id);
  }

  async function recordNickname(id, nickname) {
    accountId(id);
    const value = String(nickname || '').trim().slice(0, 64);
    if (!value) return;
    await run(client => evalRedisScript(client, `
      if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
      redis.call('HSET', KEYS[1], 'nickname', ARGV[1])
      redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
      redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', tonumber(ARGV[2]) - 7776000000)
      redis.call('ZREMRANGEBYRANK', KEYS[2], 0, -21)
      redis.call('EXPIRE', KEYS[2], 7776000)
      return 1
    `, { keys: [profileKey(id), `${prefix}nicknames:${id}`], arguments: [value, String(now())] }));
  }

  async function recordAuthFailure({ ip, code = 'AUTH_INVALID', email = '' }) {
    const event = { at: now(), ip: cleanIp(ip), code: String(code).slice(0, 64), accountHash: email ? createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 16) : '' };
    await run((client) => evalRedisScript(client, `
      while redis.call('LLEN', KEYS[1]) > 0 do
        local oldest = cjson.decode(redis.call('LINDEX', KEYS[1], -1))
        if tonumber(oldest.at) >= tonumber(ARGV[2]) - 7776000000 then break end
        redis.call('RPOP', KEYS[1])
      end
      redis.call('LPUSH', KEYS[1], ARGV[1])
      redis.call('LTRIM', KEYS[1], 0, 1999)
      redis.call('EXPIRE', KEYS[1], 7776000)
      return 1
    `, { keys: [`${prefix}events`], arguments: [JSON.stringify(event), String(now())] }));
    if (code === 'AUTH_INVALID' && typeof email === 'string' && email.length <= 254) {
      const id = await run(client => client.get(`openmusic:account:email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`));
      if (id && ACCOUNT_PATTERN.test(id)) {
        await ensureDaily(id, now());
        const recorded = await run(client => evalRedisScript(client, `
          if redis.call('HEXISTS', KEYS[1], 'firstSeenAt') == 0 then return 0 end
          redis.call('HINCRBY', KEYS[1], 'authFailures', 1)
          redis.call('HSET', KEYS[1], 'lastAuthFailureAt', ARGV[1])
          redis.call('HINCRBY', KEYS[2], 'authFailures', 1)
          redis.call('EXPIRE', KEYS[2], 3024000)
          return 1
        `, { keys: [profileKey(id), dailyKey(id, now())], arguments: [String(now())] }));
        if (recorded === 1) {
          await refreshScore(id);
        }
      }
    }
  }

  async function summary(id) {
    return run(async (client) => {
      const profile = await client.hGetAll(profileKey(id));
      if (!profile.firstSeenAt) return null;
      const timestamp = now();
      const [daily, rawIpCount, sharedAccounts, rawAccount, clientCount, roomCount, roomHistoryCount, estimated, unknownIpAt, musicIpCount, musicIpChanges] = await Promise.all([
        client.hGetAll(dailyKey(id, timestamp)),
        client.zCount(`${prefix}recent-ips:${id}`, timestamp - DAY, '+inf'),
        cleanIp(profile.lastNetworkIp || profile.lastRequestIp || profile.lastLoginIp) !== 'unknown' ? client.zCount(ipKey(profile.lastNetworkIp || profile.lastRequestIp || profile.lastLoginIp), timestamp - HISTORY_SEC * 1000, '+inf') : 0,
        client.get(`openmusic:account:${id}`),
        client.zCount(`${prefix}clients:${id}`, timestamp - DAY, '+inf'),
        client.zCard(roomDayKey(id, timestamp)),
        client.zCount(`${prefix}rooms:${id}`, timestamp - HISTORY_SEC * 1000, '+inf'),
        client.get(`${dailyKey(id, timestamp)}:seeded`),
        client.zScore(`${prefix}recent-ips:${id}`, 'unknown'),
        client.zCount(`${prefix}music-ips:${id}`, timestamp - 600000, '+inf'),
        client.zCount(`${prefix}music-ip-changes:${id}`, timestamp - 600000, '+inf'),
      ]);
      const ipCount = rawIpCount - (unknownIpAt !== null && unknownIpAt >= timestamp - DAY ? 1 : 0);
      const account = rawAccount ? JSON.parse(rawAccount) : null;
      const counts = Object.fromEntries(Object.entries(daily).map(([name, value]) => [name, Number(value)]));
      const evaluated = evaluateRisk({ musicMinutePeak: counts.musicMinutePeak, untrustedForwarded: counts.untrustedForwarded, automationClientRequests: counts.automationClientRequests, responseUrlOk: counts.response_url_ok, responseTotal: counts.response_total, responseEmpty: counts.response_empty, denied: counts.denied, minutePeak: counts.minutePeak, ipCount, sharedAccounts, musicIpCount, musicIpChanges,
        authFailures: counts.authFailures, clientCount, roomCount, errors: counts.errors,
        requests: counts.requests, musicRequests: counts.music, socketRequests: counts.socketRequests || 0, roomJoins: counts.roomJoins || 0,
        operations: Object.fromEntries(MUSIC_OPERATIONS.map(key => [key, counts[`operation_${key}`] || 0])), dailyEstimated: estimated === 'utc-conservative', accountAge: Number(profile.createdAt) > 0 ? timestamp - Number(profile.createdAt) : -1 });
      if (Number(profile.scoreResetAt || 0) >= Number(profile.lastSeenAt || 0)) {
        evaluated.score = 0;
        evaluated.level = 'low';
        evaluated.reasons = [];
        evaluated.factors = evaluated.factors.map(factor => ({ ...factor, points: 0, matched: false }));
      }
      return {
        humanChallenge: humanChallengeSnapshot(profile, dateKey(timestamp)),
        id, email: profile.email || '', status: profile.status || 'normal', tags: JSON.parse(profile.tags || '[]'), note: profile.note || '', reason: profile.reason || '',
        createdAt: Number(profile.createdAt || 0), firstSeenAt: Number(profile.firstSeenAt), lastSeenAt: Number(profile.lastSeenAt),
        registrationIp: profile.registrationIp || '', lastLoginIp: profile.lastLoginIp || '', lastRequestIp: profile.lastRequestIp || '', lastLoginAt: Number(profile.lastLoginAt || 0), loginCount: Number(profile.loginCount || 0),
        requests: Number(profile.requests || 0), musicRequests: Number(profile.musicRequests || 0), socketRequests: Number(profile.socketRequests || 0), denied: Number(profile.denied || 0), errors: Number(profile.errors || 0),
        nickname: profile.nickname || '', networkIp: profile.lastNetworkIp || profile.lastRequestIp || profile.lastLoginIp || '', lastRoomId: profile.lastRoomId || '', lastRoomAt: Number(profile.lastRoomAt || 0),
        roomJoins: Number(profile.roomJoins || 0), roomCount, roomHistoryCount, clientCount,
        authFailures: Number(profile.authFailures || 0), lastAuthFailureAt: Number(profile.lastAuthFailureAt || 0),
        lastNetworkRoute: profile.lastNetworkRoute || '', lastHumanVerifiedAt: Number(profile.lastHumanVerifiedAt || 0), sampledScore: Number(profile.score || 0), scoredAt: Number(profile.scoreAt || 0),
        ...safeIdentity(account, profile),
        daily: counts, dailyEstimated: estimated === 'utc-conservative', ipCount, sharedAccounts, musicIpCount, musicIpChanges,
        ...evaluated,
      };
    });
  }

  async function ensureStatusIndex() {
    for (let batch = 0; batch < 100; batch++) {
      const ready = await run(client => evalRedisScript(client, `
        if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
        local cursor = redis.call('GET', KEYS[2]) or '0'
        local scan = redis.call('ZSCAN', KEYS[3], cursor, 'COUNT', 200)
        for index = 1, #scan[2], 2 do
          local id = scan[2][index]
          local profile = ARGV[1] .. id
          if redis.call('HEXISTS', profile, 'firstSeenAt') == 1 then
            local status = redis.call('HGET', profile, 'status') or 'normal'
            if status ~= 'normal' and status ~= 'watch' and status ~= 'blocked' then return redis.error_reply('Invalid risk status') end
            for _, candidate in ipairs({'normal', 'watch', 'blocked'}) do
              if candidate ~= status then redis.call('ZREM', ARGV[2] .. candidate, id) end
            end
            redis.call('ZADD', ARGV[2] .. status, scan[2][index + 1], id)
            redis.call('ZADD', KEYS[4], 'NX', tonumber(redis.call('HGET', profile, 'score') or '0'), id)
            local score = tonumber(redis.call('ZSCORE', KEYS[4], id) or '0')
            if status == 'blocked' then
              redis.call('ZREM', KEYS[5], id); redis.call('ZREM', KEYS[6], id); redis.call('ZADD', KEYS[7], score, id); redis.call('ZADD', KEYS[8], scan[2][index + 1], id)
            else
              redis.call('ZADD', KEYS[5], score, id); redis.call('ZADD', KEYS[6], scan[2][index + 1], id); redis.call('ZREM', KEYS[7], id); redis.call('ZREM', KEYS[8], id)
            end
          end
        end
        if scan[1] == '0' then redis.call('SET', KEYS[1], '1'); redis.call('DEL', KEYS[2]); return 1 end
        redis.call('SET', KEYS[2], scan[1], 'EX', 604800)
        return 0
      `, { keys: [`${prefix}status-index:v5`, `${prefix}status-index:cursor:v5`, `${prefix}accounts`, `${prefix}scores`, `${prefix}main-scores`, `${prefix}main-recent`, `${prefix}blocked-scores`, `${prefix}blocked-recent`], arguments: [`${prefix}account:`, `${prefix}status:`] }));
      if (ready === 1) return;
    }
    throw new RiskControlError('RISK_INDEX_BUILDING', '历史风控索引整理中，请稍后刷新');
  }

  async function searchIdentitySnapshot(key, query) {
    const total = await run(client => client.zCard(key));
    if (total > 50_000) throw new RiskControlError('RISK_SEARCH_TOO_BROAD', '账户范围较大，请使用完整账户 ID、完整邮箱或 IP 精确搜索', 400);
    const normalized = query.normalize('NFKC').toLowerCase();
    const startedAt = Date.now();
    const matches = [];
    for (let offset = 0; offset < total; offset += 100) {
      if (Date.now() - startedAt > 5000) throw new RiskControlError('RISK_SEARCH_TIMEOUT', '搜索超时，请使用完整账户 ID、完整邮箱或 IP 重试');
      const ids = await run(client => client.zRange(key, offset, offset + 99));
      const found = await run(client => Promise.all(ids.map(async id => {
        const [rawAccount, fields, nicknames] = await Promise.all([
          client.get(`openmusic:account:${id}`),
          client.hmGet(profileKey(id), ['nickname', 'email', 'registrationIp', 'lastLoginIp', 'lastRequestIp', 'firstSeenAt', 'tags']),
          client.zRange(`${prefix}nicknames:${id}`, now() - HISTORY_SEC * 1000, '+inf', { BY: 'SCORE' }),
        ]);
        if (!fields[5]) return null;
        const account = rawAccount ? JSON.parse(rawAccount) : null;
        const identity = safeIdentity(account, { nickname: fields[0], email: fields[1] });
        const aliases = { email: '邮箱', wechat: '微信文件传输助手 weixin', github: 'GitHub', linuxdo: 'Linux.do' };
        const values = [id, identity.displayName, identity.email, identity.roomUserId, account?.displayName,
          ...fields.slice(0, 5), ...nicknames, ...JSON.parse(fields[6] || '[]'),
          ...identity.identities.flatMap(entry => [entry.username, entry.provider, aliases[entry.provider], entry.subjectHint])];
        const matched = values.some(value => typeof value === 'string' && value.normalize('NFKC').toLowerCase().includes(normalized));
        const subjectMatched = Array.isArray(account?.identities) && account.identities.some(entry => typeof entry.subject === 'string' && entry.subject === query);
        return matched || subjectMatched ? id : null;
      })));
      matches.push(...found.filter(Boolean));
    }
    await run(client => evalRedisScript(client, `
      local ids = cjson.decode(ARGV[1])
      if #ids == 0 then redis.call('DEL', KEYS[1]); return 1 end
      for _, id in ipairs(ids) do redis.call('ZADD', KEYS[2], 0, id) end
      redis.call('EXPIRE', KEYS[2], 30)
      redis.call('ZINTERSTORE', KEYS[1], 2, KEYS[1], KEYS[2], 'WEIGHTS', 1, 0)
      redis.call('EXPIRE', KEYS[1], 30)
      return 1
    `, { keys: [key, `${key}:matches`], arguments: [JSON.stringify(matches)] }));
  }

  async function list({ page = 1, pageSize = 20, status = '', pool = status === 'blocked' ? 'blocked' : 'main', order = 'risk', q = '' } = {}) {
    const currentPage = Math.min(100_000, Math.max(1, Number.parseInt(page, 10) || 1));
    const size = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
    if (status && !STATUSES.has(status)) throw new RiskControlError('RISK_FILTER_INVALID', '账户状态无效', 400);
    if (!['main', 'blocked', 'all'].includes(pool)) throw new RiskControlError('RISK_FILTER_INVALID', '账户池无效', 400);
    const effectiveStatus = pool === 'blocked' && !status ? 'blocked' : status;
    const baseRiskKey = pool === 'main' ? `${prefix}main-scores` : pool === 'blocked' ? `${prefix}blocked-scores` : `${prefix}scores`;
    const baseRecentKey = pool === 'main' ? `${prefix}main-recent` : pool === 'blocked' ? `${prefix}blocked-recent` : `${prefix}accounts`;
    const baseKey = order === 'risk' ? baseRiskKey : baseRecentKey;
    if (!['risk', 'recent'].includes(order)) throw new RiskControlError('RISK_FILTER_INVALID', '排序方式无效', 400);
    if (typeof q !== 'string' || q.length > 254 || /[\x00-\x1f]/u.test(q)) throw new RiskControlError('RISK_FILTER_INVALID', '搜索内容需为 254 字以内的单行文字', 400);
    await ensureStatusIndex();
    const query = q.trim();
    async function readPage(key) {
      const [total, ids, high, blocked] = await run((client) => Promise.all([
        client.zCard(key), client.zRangeWithScores(key, (currentPage - 1) * size, currentPage * size - 1, { REV: true }),
        client.zCount(`${prefix}scores`, 60, '+inf'), client.zCard(`${prefix}status:blocked`),
      ]));
      const items = (await Promise.all(ids.map(async entry => {
        const item = await summary(entry.value);
        return item && (pool === 'all' || (item.status === 'blocked') === (pool === 'blocked')) && { ...item, queueScore: order === 'risk' ? entry.score : item.sampledScore };
      }))).filter(Boolean);
      return { items, total, page: currentPage, pageSize: size, pool, high, blocked, scoreUpdatedOnActivity: true, timeZone: 'Asia/Shanghai', generatedAt: now() };
    }
    // 无筛选轮询直接读持久索引，避免每 30 秒复制整个账户集合
    if (!query && !effectiveStatus) return readPage(baseKey);
    if (!query && pool === 'blocked' && effectiveStatus === 'blocked') return readPage(baseKey);
    let matches = null;
    let identityQuery = '';
    if (query) {
      if (ACCOUNT_PATTERN.test(query)) matches = [query];
      else if (isIP(query)) matches = await run(client => client.zRange(ipKey(query), now() - HISTORY_SEC * 1000, '+inf', { BY: 'SCORE' }));
      else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(query)) {
        const id = await run(client => client.get(`openmusic:account:email:${createHash('sha256').update(query.toLowerCase()).digest('hex')}`));
        matches = id && ACCOUNT_PATTERN.test(id) ? [id] : [];
      } else identityQuery = query;
    }
    if (identityQuery) {
      const scopeSize = await run(client => client.zCard(effectiveStatus ? `${prefix}status:${effectiveStatus}` : baseKey));
      if (scopeSize > 50_000) throw new RiskControlError('RISK_SEARCH_TOO_BROAD', '账户范围较大，请使用完整账户 ID、完整邮箱或 IP 精确搜索', 400);
    }
    const key = `${prefix}view:${randomBytes(12).toString('hex')}`;
    await run(client => evalRedisScript(client, `
      if ARGV[2] == '1' then
        local ids = cjson.decode(ARGV[3])
        for _, id in ipairs(ids) do
          local score = redis.call('ZSCORE', KEYS[3], id)
          if score and (ARGV[1] ~= '1' or redis.call('ZSCORE', KEYS[4], id)) then
            redis.call('ZADD', KEYS[1], score, id)
          end
        end
      elseif ARGV[1] == '1' then
        redis.call('ZINTERSTORE', KEYS[1], 2, KEYS[3], KEYS[4], 'WEIGHTS', 1, 0)
      else
        redis.call('ZUNIONSTORE', KEYS[1], 1, KEYS[3])
      end
      redis.call('EXPIRE', KEYS[1], 30)
      return 1
    `, { keys: [key, `${prefix}accounts`, baseKey, `${prefix}status:${effectiveStatus}`], arguments: [effectiveStatus ? '1' : '0', matches ? '1' : '0', JSON.stringify(matches || [])] }));
    try {
      if (identityQuery) await searchIdentitySnapshot(key, identityQuery);
      return await readPage(key);
    } finally { await run(client => client.del([key, `${key}:matches`])); }
  }

  async function detail(id) {
    accountId(id);
    const result = await summary(id);
    if (!result) throw new RiskControlError('RISK_ACCOUNT_NOT_FOUND', '尚无账户风控记录', 404);
    const timestamp = now();
    const [ips, logins, days, related, roomIds, clientIds, decisions, policy, legacyDays, nicknames, ipRequests, requestEvents] = await run((client) => Promise.all([
      client.zRangeWithScores(`${prefix}ips:${id}`, timestamp - HISTORY_SEC * 1000, '+inf', { BY: 'SCORE', REV: false }),
      client.lRange(`${prefix}logins:${id}`, 0, 99),
      Promise.all(Array.from({ length: 14 }, async (_, index) => ({ date: dateKey(timestamp - index * DAY), ...await client.hGetAll(dailyKey(id, timestamp - index * DAY)) }))),
      cleanIp(result.networkIp) !== 'unknown' ? client.zRange(ipKey(result.networkIp), '+inf', timestamp - HISTORY_SEC * 1000, { BY: 'SCORE', REV: true, LIMIT: { offset: 0, count: 20 } }) : [],
      client.zRange(`${prefix}rooms:${id}`, timestamp - HISTORY_SEC * 1000, '+inf', { BY: 'SCORE' }),
      client.zRangeWithScores(`${prefix}clients:${id}`, timestamp - HISTORY_SEC * 1000, '+inf', { BY: 'SCORE' }),
      client.lRange(`${prefix}decisions:${id}`, 0, 99),
      getPolicy(),
      Promise.all(Array.from({ length: 14 }, async (_, index) => {
        const date = new Date(timestamp - index * DAY).toISOString().slice(0, 10);
        return { date, timeZone: 'UTC', ...await client.hGetAll(`${prefix}day:${id}:${date}`) };
      })),
      client.zRangeWithScores(`${prefix}nicknames:${id}`, timestamp - HISTORY_SEC * 1000, '+inf', { BY: 'SCORE' }),
      client.hVals(`${prefix}request-ip-counts:${id}`),
      client.lRange(`${prefix}request-events:${id}`, 0, 199),
    ]));
    const [rooms, clients, errorSnapshot, rawMusicResponses] = await run(client => Promise.all([
      roomIds.length ? client.hmGet(`${prefix}room-info:${id}`, roomIds).then(entries => entries.filter(Boolean).map(entry => JSON.parse(entry)).sort((left, right) => right.lastSeenAt - left.lastSeenAt)) : [],
      clientIds.length ? client.hmGet(`${prefix}client-info:${id}`, clientIds.map(entry => entry.value)).then(entries => entries.map((agent, index) => ({ userAgent: agent || '', lastSeenAt: clientIds[index].score })).sort((left, right) => right.lastSeenAt - left.lastSeenAt)) : [],
      client.multi().hGetAll(`${prefix}error-groups:${id}`).hGetAll(`${prefix}error-meta:${id}`)
        .lRange(`${prefix}error-events:${id}`, 0, 99).hGet(profileKey(id), 'errors').hGetAll(dailyKey(id, timestamp)).exec(),
      client.hVals(`${prefix}music-responses:${id}`),
    ]));
    const [errorGroups, errorMeta, errorEvents, errorTotal, errorDaily] = errorSnapshot;
    const musicResponses = rawMusicResponses.map(raw => JSON.parse(raw)).filter(event => event.at >= timestamp - DAY).sort((a, b) => b.at - a.at);
    const responseById = new Map(musicResponses.map(event => [event.requestId, event]));
    return { ...result, errors: Number(errorTotal || 0), daily: { ...result.daily, errors: Number(errorDaily.errors || 0) }, ips: ips.map((entry) => ({ ip: entry.value, lastSeenAt: entry.score })).reverse(), logins: logins.map((entry) => JSON.parse(entry)).filter((entry) => entry.at >= timestamp - HISTORY_SEC * 1000), days, relatedAccounts: related,
      rooms, clients, decisions: decisions.map(entry => JSON.parse(entry)).filter(entry => entry.at >= timestamp - HISTORY_SEC * 1000), policy,
      ipRequests: ipRequests.map(entry => JSON.parse(entry)).filter(entry => entry.lastSeenAt >= timestamp - HISTORY_SEC * 1000).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
      requestEvents: requestEvents.map(entry => JSON.parse(entry)).filter(entry => entry.at >= timestamp - DAY).map(entry => ({ ...entry, response: responseById.get(String(entry.id)) })),
      musicResponses, musicResponseAnalysis: summarizeMusicSamples(musicResponses),
      nicknames: nicknames.map(entry => ({ name: entry.value, lastSeenAt: entry.score })).reverse(),
      errorBreakdown: {
        trackedTotal: Number(errorMeta.trackedTotal || 0), sinceAt: Number(errorMeta.sinceAt || 0),
        legacyUnclassified: Math.max(0, Number(errorTotal || 0) - Number(errorMeta.trackedTotal || 0)),
        groups: Object.values(errorGroups).map(raw => { const group = JSON.parse(raw); return { ...group, today: Number(errorDaily[`error_group_${group.groupId}`] || 0) }; }).filter(group => group.lastSeenAt >= timestamp - HISTORY_SEC * 1000).sort((left, right) => right.count - left.count || right.lastSeenAt - left.lastSeenAt),
        recent: errorEvents.map(raw => JSON.parse(raw)).filter(event => event.at >= timestamp - HISTORY_SEC * 1000).sort((left, right) => right.at - left.at),
      },
      legacyDays: legacyDays.filter(day => Object.keys(day).length > 2), timeZone: 'Asia/Shanghai', retention: { ipDays: 90, loginEntries: 100, dailyDays: 35, roomEntries: 200, clientEntries: 50, decisionEntries: 100 } };
  }

  async function setDecision(id, input) {
    accountId(id);
    if (!input || !STATUSES.has(input.status) || !Array.isArray(input.tags) || input.tags.length > 10 || input.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 24) || typeof input.note !== 'string' || input.note.length > 500 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 200) {
      throw new RiskControlError('RISK_DECISION_INVALID', '处置状态、标签、备注或处置原因无效', 400);
    }
    const decision = { status: input.status, tags: [...new Set(input.tags.map((tag) => tag.trim()))], note: input.note, reason: input.reason.trim() };
    await run((client) => evalRedisScript(client, `
      if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
      local previous = redis.call('HGET', KEYS[1], 'status') or 'normal'
      redis.call('ZREM', KEYS[2] .. previous, ARGV[1])
      redis.call('HSET', KEYS[1], 'status', ARGV[2], 'tags', ARGV[3], 'note', ARGV[4], 'reason', ARGV[5], 'decisionAt', ARGV[6])
      redis.call('ZADD', KEYS[2] .. ARGV[2], ARGV[6], ARGV[1])
      local score = tonumber(redis.call('HGET', KEYS[1], 'score') or '0')
      local seen = tonumber(redis.call('HGET', KEYS[1], 'lastSeenAt') or ARGV[6])
      if ARGV[2] == 'blocked' then
        redis.call('ZREM', KEYS[4], ARGV[1]); redis.call('ZREM', KEYS[5], ARGV[1]); redis.call('ZADD', KEYS[6], score, ARGV[1]); redis.call('ZADD', KEYS[7], seen, ARGV[1])
      else
        redis.call('ZADD', KEYS[4], score, ARGV[1]); redis.call('ZADD', KEYS[5], seen, ARGV[1]); redis.call('ZREM', KEYS[6], ARGV[1]); redis.call('ZREM', KEYS[7], ARGV[1])
      end
      redis.call('LPUSH', KEYS[3], cjson.encode({at=tonumber(ARGV[6]), previousStatus=previous, status=ARGV[2], reason=ARGV[5]}))
      redis.call('LTRIM', KEYS[3], 0, 99)
      redis.call('EXPIRE', KEYS[3], 7776000)
      return 1
    `, { keys: [profileKey(id), `${prefix}status:`, `${prefix}decisions:${id}`, `${prefix}main-scores`, `${prefix}main-recent`, `${prefix}blocked-scores`, `${prefix}blocked-recent`], arguments: [id, decision.status, JSON.stringify(decision.tags), decision.note, decision.reason, String(now())] }).then((result) => {
      if (!result) throw new RiskControlError('RISK_ACCOUNT_NOT_FOUND', '尚无账户风控记录', 404);
    }));
    return decision;
  }

  async function resetRisk(id, input) {
    accountId(id);
    if (!input || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 200) {
      throw new RiskControlError('RISK_RESET_INVALID', '请填写 1 至 200 字的重置原因', 400);
    }
    const timestamp = now();
    const reason = input.reason.trim();
    const previousStatus = await sessionStatus(id);
    const result = await run(client => evalRedisScript(client, `
      if redis.call('HEXISTS', KEYS[1], 'firstSeenAt') == 0 then return cjson.encode({ found = 0 }) end
      local latest = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
      local latestIp = latest[1] or ''
      if latestIp == 'unknown' then latestIp = '' end
      redis.call('HSET', KEYS[1], 'status', 'normal', 'score', 0, 'scoreAt', ARGV[1], 'scoreResetAt', ARGV[1], 'decisionAt', ARGV[1])
      if latestIp ~= '' then redis.call('HSET', KEYS[1], 'lastNetworkIp', latestIp, 'lastRequestIp', latestIp) end
      redis.call('HDEL', KEYS[1], 'humanPending', 'humanCooldownUntil', 'lastHumanVerifiedAt')
      redis.call('ZREM', KEYS[5], ARGV[2])
      redis.call('ZREM', KEYS[6], ARGV[2])
      redis.call('ZADD', KEYS[3], 0, ARGV[2])
      redis.call('ZADD', KEYS[4], ARGV[1], ARGV[2])
      for _, status in ipairs({'normal', 'watch', 'blocked'}) do redis.call('ZREM', KEYS[7] .. status, ARGV[2]) end
      redis.call('ZADD', KEYS[7] .. 'normal', ARGV[1], ARGV[2])
      redis.call('LPUSH', KEYS[8], cjson.encode({at=tonumber(ARGV[1]), previousStatus=ARGV[3], status='normal', reason=ARGV[4], reset=true}))
      redis.call('LTRIM', KEYS[8], 0, 99)
      redis.call('EXPIRE', KEYS[8], 7776000)
      return cjson.encode({ found = 1, latestIp = latestIp })
    `, { keys: [profileKey(id), `${prefix}ips:${id}`, `${prefix}main-scores`, `${prefix}main-recent`, `${prefix}blocked-scores`, `${prefix}blocked-recent`, `${prefix}status:`, `${prefix}decisions:${id}`], arguments: [String(timestamp), id, previousStatus, reason] }));
    const parsed = JSON.parse(result);
    if (!parsed.found) throw new RiskControlError('RISK_ACCOUNT_NOT_FOUND', '尚无账户风控记录', 404);
    return { ok: true, status: 'normal', score: 0, latestIp: parsed.latestIp || '', resetAt: timestamp };
  }

  async function events() {
    return run(async (client) => (await client.lRange(`${prefix}events`, 0, 199)).map((entry) => JSON.parse(entry)).filter((entry) => entry.at >= now() - HISTORY_SEC * 1000));
  }

  async function clearHistory(input) {
    if (input?.confirm !== 'CLEAR_RISK_HISTORY') throw new RiskControlError('RISK_CLEAR_CONFIRM_REQUIRED', '请先确认清除全站风控历史数据', 400);
    const client = store();
    const lockKey = `${prefix}history-clear-lock`;
    const token = randomBytes(24).toString('hex');
    if (!await run(() => client.set(lockKey, token, { NX: true, EX: 300 }))) {
      throw new RiskControlError('RISK_CLEAR_IN_PROGRESS', '历史数据正在清理，请稍后刷新', 409);
    }
    const startedAt = now();
    const seen = new Set();
    let accounts = 0;
    const histories = ['ips', 'recent-ips', 'logins', 'clients', 'client-info', 'music-ips', 'music-ip-changes', 'request-ips', 'request-ip-counts', 'request-events', 'music-response-order', 'music-responses', 'rooms', 'room-info', 'nicknames', 'error-groups', 'error-meta', 'error-events'];
    const checkLock = `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return redis.error_reply('History clear lock expired') end\nredis.call('EXPIRE', KEYS[1], 300)\n`;
    try {
      // 分批扫描并仅处理已知历史键，账户清理与正常请求各自原子执行
      for await (const keys of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
        await run(() => evalRedisScript(client, `${checkLock}return 1`, { keys: [lockKey], arguments: [token] }));
        for (const key of keys) {
          const suffix = key.slice(prefix.length);
          const id = suffix.startsWith('account:') ? suffix.slice(8) : '';
          if (ACCOUNT_PATTERN.test(id) && !seen.has(id)) {
            seen.add(id);
            const timestamp = now();
            await ensureDaily(id, timestamp);
            accounts += await run(() => evalRedisScript(client, `${checkLock}
              if redis.call('HEXISTS', KEYS[2], 'firstSeenAt') == 0 then return 0 end
              for index = 4, #KEYS do redis.call('DEL', KEYS[index]) end
              redis.call('HDEL', KEYS[2], 'registrationIp', 'lastLoginIp', 'lastLoginAt', 'lastHumanVerifiedAt', 'lastNetworkRoute', 'lastRequestIp', 'lastNetworkIp', 'lastMusicIp', 'lastMusicAt', 'lastRoomId', 'lastRoomAt', 'lastAuthFailureAt', 'lastDeniedAt', 'lastDeniedCode')
              redis.call('HSET', KEYS[2], 'loginCount', 0)
              for _, field in ipairs({'requests', 'musicRequests', 'socketRequests', 'imageRequests', 'apiRequests', 'denied', 'errors', 'authFailures', 'roomJoins'}) do
                local dailyField = field == 'musicRequests' and 'music' or field
                redis.call('HSET', KEYS[2], field, redis.call('HGET', KEYS[3], dailyField) or '0')
              end
              return 1
            `, { keys: [lockKey, profileKey(id), dailyKey(id, timestamp), ...histories.map(kind => `${prefix}${kind}:${id}`)], arguments: [token] }));
            await refreshScore(id);
          } else if (/^ip:[a-f0-9]{64}$/u.test(suffix)) {
            // 保留本次清理开始后重新活跃的 IP 关联及独立的 IP 分钟额度
            await run(() => evalRedisScript(client, `${checkLock}return redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])`, { keys: [lockKey, key], arguments: [token, String(startedAt)] }));
          } else {
            const day = suffix.match(/^(day-cn|day|room-day):(acct_[a-zA-Z0-9_-]{16,64}):(\d{4}-\d{2}-\d{2})(:seeded)?$/u);
            if (!day) continue;
            const timestamp = now();
            const earliestUtc = new Date(Math.floor((timestamp + CHINA_OFFSET) / DAY) * DAY - CHINA_OFFSET).toISOString().slice(0, 10);
            // 旧 UTC 桶仍可能参与今日迁移，连同今日迁移标记一起保留
            if (day[3] < (day[1] === 'day' ? earliestUtc : dateKey(timestamp))) {
              await run(() => evalRedisScript(client, `${checkLock}return redis.call('DEL', KEYS[2])`, { keys: [lockKey, key], arguments: [token] }));
            }
          }
        }
      }
      await run(() => evalRedisScript(client, `${checkLock}
        local events = redis.call('LRANGE', KEYS[2], 0, -1)
        redis.call('DEL', KEYS[2])
        for _, raw in ipairs(events) do
          if tonumber(cjson.decode(raw).at) > tonumber(ARGV[2]) then redis.call('RPUSH', KEYS[2], raw) end
        end
        redis.call('EXPIRE', KEYS[2], 7776000)
        return 1
      `, { keys: [lockKey, `${prefix}events`], arguments: [token, String(startedAt)] }));
      return { ok: true, accounts, clearedAt: now() };
    } catch (error) {
      if (error instanceof RiskControlError && error.status !== 503) throw error;
      throw new RiskControlError('RISK_HISTORY_CLEAR_FAILED', '清理未完成，部分历史记录可能已清理，请重试');
    } finally {
      await run(() => evalRedisScript(client, `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, { keys: [lockKey], arguments: [token] }));
    }
  }

  return { humanChallengeStatus, completeHumanChallenge, setHumanChallengeBypass, getPolicy, setPolicy, sessionStatus, assertAllowed, recordLogin, consume, recordMusicResponse, recordOutcome, recordRoomVisit, recordNickname, recordAuthFailure, list, detail, setDecision, resetRisk, events, clearHistory };
}

export const riskControl = createRiskControl();
