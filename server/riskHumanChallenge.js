// 状态保存在已有账户画像 Hash，每次资源请求复用 consume 的 Lua，不增加 Redis 往返或每日新键
export const HUMAN_GATE_LUA = `
local function humanDay(key, day)
  if redis.call('HGET', key, 'humanDay') ~= day then
    local pending = redis.call('HGET', key, 'humanPending')
    redis.call('HSET', key, 'humanDay', day, 'humanTriggers', pending and 1 or 0, 'humanPasses', 0)
  end
end
local function humanGate(key, now, day, nonce, abnormal, channel, accountId, forced)
  if redis.call('HGET', key, 'humanBypass') == '1' then return 0 end
  if redis.call('HEXISTS', key, 'humanPending') == 1 then return 1 end
  if not abnormal then return 0 end
  humanDay(key, day)
  if not forced then
    if tonumber(redis.call('HGET', key, 'humanCooldownUntil') or '0') > now then return 0 end
  end
  redis.call('HSET', key, 'humanPending', nonce, 'humanTriggeredAt', now)
  local triggers = redis.call('HINCRBY', key, 'humanTriggers', 1)
  redis.call('HINCRBY', key, 'humanTriggerTotal', 1)
  if channel and channel ~= '' then redis.call('PUBLISH', channel, accountId) end
  if not forced and triggers >= 3 then return 2 end
  return 1
end
`;

export const HUMAN_COMPLETE_SCRIPT = `${HUMAN_GATE_LUA}
if redis.call('HGET', KEYS[1], 'humanPending') ~= ARGV[3] then return 0 end
if redis.call('HGET', KEYS[1], 'status') == 'blocked' or redis.call('HGET', KEYS[1], 'humanBypass') == '1' then return -1 end
humanDay(KEYS[1], ARGV[2])
redis.call('HDEL', KEYS[1], 'humanPending')
local passes = redis.call('HINCRBY', KEYS[1], 'humanPasses', 1)
redis.call('HINCRBY', KEYS[1], 'humanPassTotal', 1)
local baseCooldown = tonumber(ARGV[4])
local cooldown = passes >= 2 and math.min(baseCooldown * 2, 86400000) or baseCooldown
redis.call('HSET', KEYS[1], 'lastHumanVerifiedAt', ARGV[1], 'humanCooldownUntil', tonumber(ARGV[1]) + cooldown)
return 1
`;

export function humanChallengeSnapshot(profile, day) {
  return {
    pending: Boolean(profile.humanPending), challengeId: profile.humanPending || '',
    day, triggers: profile.humanDay === day ? Number(profile.humanTriggers || 0) : profile.humanPending ? 1 : 0,
    passes: profile.humanDay === day ? Number(profile.humanPasses || 0) : 0,
    triggerTotal: Number(profile.humanTriggerTotal || 0), passTotal: Number(profile.humanPassTotal || 0),
    bypass: profile.humanBypass === '1', bypassReason: profile.humanBypassReason || '',
    lastTriggeredAt: Number(profile.humanTriggeredAt || 0), lastVerifiedAt: Number(profile.lastHumanVerifiedAt || 0),
    cooldownUntil: Number(profile.humanCooldownUntil || 0), dailyLimit: 0,
  };
}

export function publicHumanChallengeState(state, config) {
  const enabled = config.riskChallengeEnabled && config.turnstileEnabled;
  const pending = Boolean(enabled && state.pending && !state.bypass);
  return {
    pending, challengeId: pending ? state.challengeId : '',
    siteKey: enabled ? config.turnstileSiteKey : '',
    passes: state.passes, dailyLimit: state.dailyLimit,
  };
}
