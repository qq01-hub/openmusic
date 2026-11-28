/**
 * 建房限流。
 * - 硬限流：同一设备 / 用户 冷却期内最多创建 1 次（时长见 runtimeConfig.roomCreateCooldownMs）
 * - 空闲自建房复用（见 index.js findIdleOwnedRoom）堵住刷房号
 */

import { getRuntimeConfig } from './runtimeConfig.js';
import { SOFT_BLOCK_CODES, softBlockMessage } from './softBlock.js';

const MAX_KEYS = 8_000;

function getGuardSettings() {
  const cfg = getRuntimeConfig();
  return {
    cooldownMs: Number(cfg.roomCreateCooldownMs) || 0,
    ipLooseCooldownMs: Number(cfg.roomCreateIpLooseCooldownMs) || 0,
  };
}

/** @type {Map<string, number>} key -> nextAllowedAt */
const cooldownUntil = new Map();

let lastSweepAt = 0;

function sweep(now) {
  if (now - lastSweepAt < 60_000) return;
  lastSweepAt = now;
  for (const [key, until] of cooldownUntil) {
    if (until <= now) cooldownUntil.delete(key);
  }
}

function rememberMapEntry(map, key, value, maxKeys) {
  if (!map.has(key) && map.size >= maxKeys) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function sanitizeId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : '';
}

/** 硬限流桶：仅 userId / deviceId（不用 IP，避免公司 NAT 误伤） */
function cooldownKeys({ deviceId, userId }) {
  const keys = [];
  const did = sanitizeId(deviceId);
  if (did) keys.push(`did:${did}`);
  const uid = sanitizeId(userId);
  if (uid) keys.push(`uid:${uid}`);
  return keys;
}

/**
 * @returns {{ allowed: true } | { allowed: false, error: string, code: string, retryAfterSec: number }}
 */
export function checkRoomCreateCooldown({ ip, deviceId, userId } = {}) {
  const now = Date.now();
  sweep(now);
  const { cooldownMs, ipLooseCooldownMs } = getGuardSettings();
  if (cooldownMs <= 0 && ipLooseCooldownMs <= 0) return { allowed: true };

  const keys = cooldownKeys({ deviceId, userId });
  if (keys.length === 0) {
    // 无设备/用户标识时退化为按 IP 宽松限流（防裸刷）
    if (ip && ipLooseCooldownMs > 0) {
      const ipKey = `ip-loose:${ip}`;
      const until = cooldownUntil.get(ipKey) || 0;
      if (until > now) {
        const retryAfterSec = Math.max(1, Math.ceil((until - now) / 1000));
        const code = SOFT_BLOCK_CODES.ROOM_CREATE_COOLDOWN_IP;
        return {
          allowed: false,
          error: softBlockMessage(code),
          code,
          retryAfterSec,
        };
      }
    }
    return { allowed: true };
  }

  if (cooldownMs <= 0) return { allowed: true };

  let blockedUntil = 0;
  for (const key of keys) {
    const until = cooldownUntil.get(key) || 0;
    if (until > now) blockedUntil = Math.max(blockedUntil, until);
  }

  if (blockedUntil > now) {
    const retryAfterSec = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
    const code = SOFT_BLOCK_CODES.ROOM_CREATE_COOLDOWN;
    return {
      allowed: false,
      error: softBlockMessage(code),
      code,
      retryAfterSec,
    };
  }
  return { allowed: true };
}

function markCooldown({ ip, deviceId, userId }, now) {
  const { cooldownMs, ipLooseCooldownMs } = getGuardSettings();
  const keys = cooldownKeys({ deviceId, userId });
  if (keys.length > 0) {
    if (cooldownMs <= 0) return;
    const until = now + cooldownMs;
    for (const key of keys) {
      rememberMapEntry(cooldownUntil, key, until, MAX_KEYS);
    }
  } else if (ip && ipLooseCooldownMs > 0) {
    // 无 did/uid：IP 用更短冷却，降低 NAT 误伤面
    rememberMapEntry(cooldownUntil, `ip-loose:${ip}`, now + ipLooseCooldownMs, MAX_KEYS);
  }
}

/**
 * 记录一次成功建房（含空房复用），仅写入冷却，不封禁。
 */
export function recordRoomCreate({ ip, deviceId, userId } = {}) {
  const now = Date.now();
  sweep(now);
  markCooldown({ ip, deviceId, userId }, now);
}

/** 测试/运维用：清空进程内状态 */
export function _resetRoomCreateGuardForTests() {
  cooldownUntil.clear();
  lastSweepAt = 0;
}

