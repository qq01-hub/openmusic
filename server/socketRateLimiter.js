import { createHash } from 'node:crypto';

const DISTRIBUTED_FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

const ACTION_EVENTS = new Set([
  'rename_user',
  'set_user_avatar',
  'rename_room',
  'set_room_lock',
  'apply_room_permanent',
  'cancel_room_permanent',
  'set_room_fm_mode',
  'music_account_qr_create',
  'music_account_qr_check',
  'music_account_bind',
  'music_account_list',
  'music_account_set_shared',
  'music_account_unbind',
  'set_room_play_mode',
  'set_room_announcement',
  'set_room_custom_cover',
  'set_room_chat_history',
  'set_room_chat_avatars',
  'set_room_join_notice',
  'set_room_ai_settings',
  'set_room_playback_rate',
  'set_room_max_admins',
  'set_room_song_request',
  'ban_room_song',
  'unban_room_song',
  'add_room_forbidden_word',
  'remove_room_forbidden_word',
  'set_room_member_tier',
  'remove_room_member_tier',
  'set_room_member_settings',
  'set_room_admin_self_manage_member_tier',
  'set_chat_mute',
  'kick_user',
  'transfer_owner',
  'set_room_admin',
  'add_song',
  'remove_song',
  'clear_queue',
  'report_playback_media',
  'skip_song',
  'finish_song',
  'request_jump',
  'reorder_queue',
  'toggle_queue_like',
  'toggle_current_dislike',
  'approve_jump',
  'reject_jump',
  'request_skip',
  'approve_skip',
  'reject_skip',
  'report_track_duration',
  'set_favorite',
  'set_favorite_category',
  'create_favorite_category',
  'import_favorites',
  'create_favorite_share',
  'revoke_favorite_share',
  'toggle_play',
  'seek',
]);

const EXTRA_POLICIES = new Map([
  ['destroy_room', { windowMs: 60_000, max: 3 }],
  ['send_chat', { windowMs: 60_000, max: 30 }],
  ['recall_chat', { windowMs: 60_000, max: 30 }],
  ['toggle_chat_reaction', { windowMs: 60_000, max: 60 }],
  ['load_chat_history', { windowMs: 60_000, max: 60 }],
  ['load_song_history', { windowMs: 60_000, max: 60 }],
  ['list_favorites', { windowMs: 60_000, max: 60 }],
  ['list_favorite_categories', { windowMs: 60_000, max: 60 }],
  ['preview_favorite_share', { windowMs: 60_000, max: 60 }],
  ['ack_error_report_solution', { windowMs: 60_000, max: 60 }],
  ['ack_room_permanent_decision', { windowMs: 60_000, max: 60 }],
]);

export function getSocketEventRatePolicy(event) {
  const name = String(event || '');
  if (ACTION_EVENTS.has(name)) return { windowMs: 60_000, max: 90 };
  return EXTRA_POLICIES.get(name) || null;
}

export function buildSocketRatePrincipal({ userId, ip }) {
  const identity = String(userId || '').trim();
  if (identity) return `user:${identity}`;
  const address = String(ip || '').trim();
  return `ip:${address || 'unknown'}`;
}

function createMemoryFixedWindow({ maxBuckets = 20_000, now = Date.now } = {}) {
  const buckets = new Map();
  return (key, { windowMs, max }) => {
    const currentTime = now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= currentTime) {
      if (!bucket && buckets.size >= maxBuckets) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      buckets.set(key, { count: 1, resetAt: currentTime + windowMs });
      return { allowed: true, retryAfterMs: 0, source: 'memory' };
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= max,
      retryAfterMs: Math.max(1, bucket.resetAt - currentTime),
      source: 'memory',
    };
  };
}

function rateKey(scope, principal) {
  const digest = createHash('sha256').update(principal).digest('hex').slice(0, 32);
  return `openmusic:rate:socket:v1:${scope}:${digest}`;
}

export function createDistributedSocketRateLimiter({
  getRedisClient,
  onRedisError,
  now,
  allowMemoryFallback = process.env.NODE_ENV !== 'production',
} = {}) {
  const consumeMemory = createMemoryFixedWindow({ now });

  return {
    async consume({ scope, principal, windowMs, max }) {
      const key = rateKey(String(scope || 'unknown').replace(/[^a-z0-9:_-]/gi, '_'), principal);
      const redis = getRedisClient?.();
      if (redis?.isReady) {
        try {
          const result = await redis.eval(DISTRIBUTED_FIXED_WINDOW_SCRIPT, {
            keys: [key],
            arguments: [String(windowMs)],
          });
          const count = Number(result?.[0]);
          const ttl = Number(result?.[1]);
          if (!Array.isArray(result) || result.length !== 2 || !Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(ttl) || ttl < 0) {
            throw new Error('Invalid rate limit reply');
          }
          return {
            allowed: count <= max,
            retryAfterMs: count <= max ? 0 : Math.max(1, ttl),
            source: 'redis',
          };
        } catch (error) {
          onRedisError?.(error);
        }
      }
      if (allowMemoryFallback) return consumeMemory(key, { windowMs, max });
      return {
        allowed: false,
        retryAfterMs: 1_000,
        source: 'unavailable',
        unavailable: true,
      };
    },
  };
}
